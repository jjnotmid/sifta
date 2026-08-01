import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { disposeByAnalyst, findInheritableClearance, investigate } from '../../src/agent/index.js';
import { createAlert, getAlert } from '../../src/memory/alerts.js';
import { countDecisions, recallPriorDecisions } from '../../src/memory/decisions.js';
import { getInvestigation } from '../../src/memory/investigations.js';
import { migrate } from '../../src/memory/migrate.js';
import { closePool } from '../../src/memory/pool.js';
import { insertVariants } from '../../src/memory/variants.js';
import { generateVariants } from '../../src/ingest/variants.js';
import { upsertEntity } from '../../src/memory/watchlist.js';
import type { Alert, Decision } from '../../src/memory/types.js';
import { MockLLMProvider, textResponse, toolUseResponse } from '../../src/providers/mock.js';
import { subjectKey } from '../../src/normalize.js';
import { ProviderUnavailableError } from '../../src/providers/types.js';
import { resetTables, vec } from '../helpers/db.js';

const SUBJECT = 'CHUKWUEMEKA OKAFOR';
const SUBJECT_DOB = '1975-04-12';
const SUBJECT_NAT = 'Nigeria';

let entityId: string;

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetTables();
  entityId = await upsertEntity({
    sourceList: 'OFAC_SDN',
    sourceRef: 'AGENT-1',
    jurisdiction: 'NG',
    primaryName: SUBJECT,
    dob: '1943-09-20',
    nationality: 'Nigeria',
  });
  await seedVariants(entityId, SUBJECT);
});

/**
 * Index an entity the way production ingestion does: the primary name plus
 * every generated variant. Seeding only the primary name would make these
 * tests pass or fail for reasons the real pipeline never encounters.
 */
async function seedVariants(id: string, name: string): Promise<void> {
  const variants = [
    { text: name, kind: 'primary' as const },
    ...generateVariants(name).map((v) => ({ text: v.text, kind: v.kind })),
  ];
  await insertVariants(
    variants.map((v) => ({
      entityId: id,
      jurisdiction: 'NG',
      variantText: v.text,
      variantKind: v.kind,
      embedding: vec(v.text),
    })),
  );
}

async function raiseAlert(overrides: Partial<Parameters<typeof createAlert>[0]> = {}): Promise<Alert> {
  return createAlert({
    subjectName: SUBJECT,
    subjectKey: subjectKey(SUBJECT, SUBJECT_DOB, SUBJECT_NAT),
    subjectDob: SUBJECT_DOB,
    subjectNat: SUBJECT_NAT,
    jurisdiction: 'NG',
    txnRef: 'TXN-001',
    txnNarration: 'Transfer to supplier',
    ...overrides,
  });
}

/** Scripted: inspect identifiers, then propose. */
function investigatingLlm(): MockLLMProvider {
  return new MockLLMProvider({
    responses: [
      toolUseResponse('compare_identifiers', { entity_id: '' }),
      toolUseResponse('propose_disposition', {
        disposition: 'CLEARED',
        rationale:
          'Date of birth mismatch: subject born 1975-04-12, listed individual born 1943-09-20.',
      }),
    ],
  });
}

describe('the investigation loop', () => {
  it('runs alert → candidates → comparison → proposed disposition', async () => {
    const alert = await raiseAlert();
    const llm = new MockLLMProvider({
      responses: [
        toolUseResponse('compare_identifiers', { entity_id: entityId }),
        toolUseResponse('propose_disposition', {
          disposition: 'CLEARED',
          rationale: 'DOB mismatch: 1975 vs 1943.',
          entity_id: entityId,
        }),
      ],
    });

    const outcome = await investigate(alert, { llm });

    expect(outcome.candidates.length).toBeGreaterThan(0);
    expect(outcome.candidates[0]!.entityId).toBe(entityId);
    expect(outcome.proposal).not.toBeNull();
    expect(outcome.proposal!.disposition).toBe('CLEARED');
    expect(outcome.kind).toBe('AWAITING_HUMAN');
  });

  it('never writes a disposition to the ledger by itself', async () => {
    const alert = await raiseAlert();
    await investigate(alert, { llm: investigatingLlm() });

    // The agent proposes; a human disposes. Nothing reaches the ledger until
    // an analyst acts. This is a compliance requirement, not a preference.
    expect(await countDecisions()).toBe(0);
  });

  it('routes a proposed HIT to human review rather than disposing it', async () => {
    const alert = await raiseAlert();
    const llm = new MockLLMProvider({
      responses: [
        toolUseResponse('propose_disposition', {
          disposition: 'HIT',
          rationale: 'Name, DOB and nationality all consistent with the listed individual.',
          entity_id: entityId,
        }),
      ],
    });

    const outcome = await investigate(alert, { llm });
    expect(outcome.proposal!.disposition).toBe('HIT');
    expect(outcome.kind).toBe('AWAITING_HUMAN');
    expect(await countDecisions()).toBe(0);

    const stored = await getAlert(alert.id);
    expect(stored!.status).toBe('ESCALATED');
  });

  it('handles zero candidates without erroring', async () => {
    const alert = await createAlert({
      subjectName: 'ZZZZQQQQ XXXXVVVV',
      subjectKey: subjectKey('ZZZZQQQQ XXXXVVVV'),
      jurisdiction: 'NG',
    });

    const llm = new MockLLMProvider({ responses: [] });
    const outcome = await investigate(alert, { llm, matchThreshold: 0.2 });

    expect(outcome.kind).toBe('NO_CANDIDATES');
    expect(outcome.proposal).toBeNull();
    // No model call is needed when nothing matched.
    expect(llm.calls).toHaveLength(0);
  });

  it('persists a tool trace that reconstructs the investigation', async () => {
    const alert = await raiseAlert();
    const outcome = await investigate(alert, { llm: investigatingLlm() });

    const investigation = await getInvestigation(outcome.investigationId);
    expect(investigation).not.toBeNull();
    expect(investigation!.stepCount).toBeGreaterThanOrEqual(3);

    const tools = investigation!.toolTrace.map((s) => s.tool);
    expect(tools[0]).toBe('search_watchlist');
    expect(tools).toContain('recall_prior_decisions');
    expect(tools).toContain('propose_disposition');

    // Steps are numbered in order and carry inputs, outputs and timestamps —
    // the trace is the audit artefact, so it must be complete.
    investigation!.toolTrace.forEach((step, i) => {
      expect(step.step).toBe(i + 1);
      expect(step).toHaveProperty('input');
      expect(step).toHaveProperty('output');
      expect(Date.parse(step.at)).not.toBeNaN();
    });
  });
});

describe('the memory test — the product thesis', () => {
  it('auto-disposes an identical re-screen from a prior CLEARED decision', async () => {
    // --- Day 1: full investigation, analyst clears it -------------------
    const firstAlert = await raiseAlert({ txnRef: 'TXN-001' });
    const firstLlm = investigatingLlm();
    const first = await investigate(firstAlert, { llm: firstLlm });

    expect(first.kind).toBe('AWAITING_HUMAN');
    expect(first.recalled).toHaveLength(0);
    expect(firstLlm.calls.length).toBeGreaterThan(0);

    const analystDecision = await disposeByAnalyst({
      alert: firstAlert,
      disposition: 'CLEARED',
      rationale:
        'Not the sanctioned individual. Subject DOB 1975-04-12 against listed 1943-09-20; long-standing customer since 2019.',
      decidedBy: 'amaka@example.com',
      entityId,
    });
    expect(analystDecision.disposition).toBe('CLEARED');

    // --- Day 2: the same subject transacts again ------------------------
    const secondAlert = await raiseAlert({ txnRef: 'TXN-002' });
    const secondLlm = investigatingLlm();
    const second = await investigate(secondAlert, { llm: secondLlm });

    expect(second.kind).toBe('AUTO_CLEARED');
    expect(second.inheritedFrom).toBe(analystDecision.id);

    // The whole point: no investigation was re-run.
    expect(secondLlm.calls).toHaveLength(0);

    // The clearance carries the analyst's own words forward.
    expect(second.decision).not.toBeNull();
    expect(second.decision!.rationale).toContain('DOB 1975-04-12');
    expect(second.decision!.decidedBy).toBe('system:memory-recall');

    const stored = await getAlert(secondAlert.id);
    expect(stored!.status).toBe('CLEARED');

    // Both decisions are on the ledger; nothing was overwritten.
    const ledger = await recallPriorDecisions(secondAlert.subjectKey);
    expect(ledger).toHaveLength(2);
  });

  it('recalls across a name reordering, because the subject key is order-insensitive', async () => {
    const firstAlert = await raiseAlert();
    await investigate(firstAlert, { llm: investigatingLlm() });
    const prior = await disposeByAnalyst({
      alert: firstAlert,
      disposition: 'CLEARED',
      rationale: 'DOB mismatch confirmed against passport.',
      decidedBy: 'amaka@example.com',
      entityId,
    });

    // The customer writes their name the other way round this time.
    const reordered = 'OKAFOR CHUKWUEMEKA';
    const secondAlert = await createAlert({
      subjectName: reordered,
      subjectKey: subjectKey(reordered, SUBJECT_DOB, SUBJECT_NAT),
      subjectDob: SUBJECT_DOB,
      subjectNat: SUBJECT_NAT,
      jurisdiction: 'NG',
    });

    const llm = investigatingLlm();
    const outcome = await investigate(secondAlert, { llm });

    expect(outcome.kind).toBe('AUTO_CLEARED');
    expect(outcome.inheritedFrom).toBe(prior.id);
    expect(llm.calls).toHaveLength(0);
  });

  it('does NOT auto-clear when the subject has a different date of birth', async () => {
    const firstAlert = await raiseAlert();
    await investigate(firstAlert, { llm: investigatingLlm() });
    await disposeByAnalyst({
      alert: firstAlert,
      disposition: 'CLEARED',
      rationale: 'DOB mismatch.',
      decidedBy: 'amaka@example.com',
      entityId,
    });

    // Same name, different person. A namesake must never inherit a clearance.
    const namesake = await createAlert({
      subjectName: SUBJECT,
      subjectKey: subjectKey(SUBJECT, '1943-09-20', SUBJECT_NAT),
      subjectDob: '1943-09-20',
      subjectNat: SUBJECT_NAT,
      jurisdiction: 'NG',
    });

    const llm = investigatingLlm();
    const outcome = await investigate(namesake, { llm });

    expect(outcome.kind).toBe('AWAITING_HUMAN');
    expect(outcome.inheritedFrom).toBeNull();
    expect(llm.calls.length).toBeGreaterThan(0);
  });

  it('does not let a later HIT be overridden by an earlier clearance', () => {
    const base = {
      id: 'd1',
      alertId: 'a1',
      subjectKey: 'k',
      entityId: 'e1',
      rationale: 'r',
      decidedBy: 'analyst',
      agentAssisted: false,
      agentReasoning: null,
    };
    const recalled = [
      { ...base, id: 'd2', disposition: 'HIT', decidedAt: new Date('2026-02-01') },
      { ...base, id: 'd1', disposition: 'CLEARED', decidedAt: new Date('2026-01-01') },
    ] as Decision[];
    const matching = [{ entityId: 'e1' }] as never;

    expect(findInheritableClearance(recalled, matching)).toBeNull();
  });

  it('does not auto-clear when the subject now matches an unadjudicated entity', async () => {
    const firstAlert = await raiseAlert();
    await investigate(firstAlert, { llm: investigatingLlm() });
    await disposeByAnalyst({
      alert: firstAlert,
      disposition: 'CLEARED',
      rationale: 'DOB mismatch.',
      decidedBy: 'amaka@example.com',
      entityId,
    });

    // A newly sanctioned individual with the same name is added to the list.
    const newEntity = await upsertEntity({
      sourceList: 'OFAC_SDN',
      sourceRef: 'AGENT-2',
      jurisdiction: 'NG',
      primaryName: SUBJECT,
      dob: '1975-04-12',
      nationality: 'Nigeria',
    });
    await seedVariants(newEntity, SUBJECT);

    const secondAlert = await raiseAlert({ txnRef: 'TXN-003' });
    const llm = investigatingLlm();
    const outcome = await investigate(secondAlert, { llm });

    // Evidence has changed. Inheriting the old clearance here would be a
    // false auto-clear — the failure mode that must not happen.
    expect(outcome.kind).toBe('AWAITING_HUMAN');
    expect(outcome.inheritedFrom).toBeNull();
  });
});

describe('degradation', () => {
  it('leaves a recoverable investigation when the model fails mid-loop', async () => {
    const alert = await raiseAlert();
    const failing = new MockLLMProvider();
    failing.generate = async () => {
      throw new ProviderUnavailableError('Bedrock throttled the request', true);
    };

    const outcome = await investigate(alert, { llm: failing });

    expect(outcome.kind).toBe('FAILED');
    expect(outcome.error).toContain('throttled');

    // Nothing written to the ledger.
    expect(await countDecisions()).toBe(0);

    // The alert returns to the human queue rather than being stranded
    // mid-investigation.
    const stored = await getAlert(alert.id);
    expect(stored!.status).toBe('OPEN');

    // The partial trace survives and records why it stopped.
    const investigation = await getInvestigation(outcome.investigationId);
    expect(investigation!.state).toBe('AWAITING_HUMAN');
    const tools = investigation!.toolTrace.map((s) => s.tool);
    expect(tools).toContain('search_watchlist');
    expect(tools).toContain('error');
  });

  it('hands over to a human when the model ends its turn without proposing', async () => {
    const alert = await raiseAlert();
    const llm = new MockLLMProvider({ responses: [textResponse('I am not sure.')] });

    const outcome = await investigate(alert, { llm });
    expect(outcome.kind).toBe('AWAITING_HUMAN');
    expect(outcome.proposal).toBeNull();
    expect(await countDecisions()).toBe(0);
  });

  it('reports a failing tool back to the model instead of aborting', async () => {
    const alert = await raiseAlert();
    const llm = new MockLLMProvider({
      responses: [
        // Nonexistent entity: compare_identifiers throws.
        toolUseResponse('compare_identifiers', {
          entity_id: '00000000-0000-0000-0000-000000000000',
        }),
        toolUseResponse('propose_disposition', {
          disposition: 'ESCALATED',
          rationale: 'Could not verify identifiers; routing for manual review.',
        }),
      ],
    });

    const outcome = await investigate(alert, { llm });
    expect(outcome.proposal!.disposition).toBe('ESCALATED');

    const investigation = await getInvestigation(outcome.investigationId);
    const errorStep = investigation!.toolTrace.find((s) => s.tool === 'compare_identifiers');
    expect(errorStep!.output).toHaveProperty('error');
  });
});
