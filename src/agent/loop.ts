import { setAlertStatus } from '../memory/alerts.js';
import { recallPriorDecisions, recordDecision } from '../memory/decisions.js';
import {
  appendToolStep,
  setInvestigationState,
  startInvestigation,
} from '../memory/investigations.js';
import type { Alert, Candidate, Decision, Disposition } from '../memory/types.js';
import { getEmbeddingProvider, getLLMProvider } from '../providers/index.js';
import { ProviderUnavailableError } from '../providers/types.js';
import type { LLMProvider, Message, ToolResult } from '../providers/types.js';
import { DEFAULT_MATCH_THRESHOLD } from '../screening/index.js';
import {
  TOOL_DEFINITIONS,
  compareIdentifiers,
  getCounterpartyHistory,
  parseProposal,
  recallPriorDecisionsTool,
  searchWatchlist,
  type DispositionProposal,
  type ToolContext,
} from './tools.js';

export type OutcomeKind =
  | 'AUTO_CLEARED'
  | 'AWAITING_HUMAN'
  | 'NO_CANDIDATES'
  | 'FAILED';

export interface AgentOutcome {
  kind: OutcomeKind;
  investigationId: string;
  /** The agent's recommendation. Never itself a final disposition. */
  proposal: DispositionProposal | null;
  /** Written only on auto-clear, which inherits a human's prior decision. */
  decision: Decision | null;
  /** Prior adjudications found for this subject. */
  recalled: Decision[];
  candidates: Candidate[];
  steps: number;
  /** The prior decision an auto-clear inherited from. */
  inheritedFrom: string | null;
  error: string | null;
}

export interface InvestigateOptions {
  llm?: LLMProvider;
  maxSteps?: number;
  matchThreshold?: number;
  /** Skip the memory short-circuit. Used to demonstrate the contrast. */
  skipMemory?: boolean;
}

const SYSTEM_PROMPT = `You are an AML screening assistant for a Nigerian financial institution.

You investigate whether a transacting customer is the sanctioned individual an
alert matched them to. You have tools for watchlist search, prior-decision
recall, counterparty history, and identifier comparison.

Rules:
- Always check recall_prior_decisions before investigating from scratch.
- Base your reasoning on evidence from tools, never on assumption.
- Absent evidence is not exculpatory. A missing date of birth is 'unknown',
  not a mismatch, and must not be used to clear a subject.
- You PROPOSE a disposition. A human analyst decides. Never state that an
  alert has been cleared or confirmed.
- Call propose_disposition exactly once, at the end, with a rationale that
  cites the specific evidence you relied on.`;

/**
 * Run an investigation for one alert.
 *
 * Memory is consulted BEFORE the model. If this subject has been adjudicated
 * before and the evidence has not changed, the alert is disposed from the
 * ledger without an LLM call at all — which is the entire product thesis, and
 * also the cheapest possible path.
 */
export async function investigate(
  alert: Alert,
  options: InvestigateOptions = {},
): Promise<AgentOutcome> {
  const maxSteps = options.maxSteps ?? 8;
  const threshold = options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;

  const investigation = await startInvestigation(alert.id);
  const outcome: AgentOutcome = {
    kind: 'AWAITING_HUMAN',
    investigationId: investigation.id,
    proposal: null,
    decision: null,
    recalled: [],
    candidates: [],
    steps: 0,
    inheritedFrom: null,
    error: null,
  };

  try {
    await setInvestigationState(investigation.id, 'GATHERING');
    await setAlertStatus(alert.id, 'INVESTIGATING');

    const context: ToolContext = { alert, candidates: [] };

    // --- Step 1: screen -------------------------------------------------
    const search = await searchWatchlist({}, context);
    await appendToolStep(investigation.id, {
      tool: 'search_watchlist',
      input: { name: alert.subjectName },
      output: { candidateCount: search.candidates.length },
    });
    outcome.candidates = search.candidates;
    outcome.steps++;

    const matching = search.candidates.filter((c) => c.distance <= threshold);

    if (matching.length === 0) {
      // Nothing matched. There is no investigation to run and nothing for a
      // human to review; the alert closes with no candidates.
      await setInvestigationState(investigation.id, 'DONE');
      await setAlertStatus(alert.id, 'CLEARED');
      outcome.kind = 'NO_CANDIDATES';
      return outcome;
    }

    // --- Step 2: memory -------------------------------------------------
    const recalled = await recallPriorDecisions(alert.subjectKey);
    await appendToolStep(investigation.id, {
      tool: 'recall_prior_decisions',
      input: { subject_key: alert.subjectKey },
      output: {
        priorCount: recalled.length,
        dispositions: recalled.map((d) => d.disposition),
      },
    });
    outcome.recalled = recalled;
    outcome.steps++;

    if (!options.skipMemory) {
      const inherited = findInheritableClearance(recalled, matching);
      if (inherited) {
        const decision = await recordDecision({
          alertId: alert.id,
          subjectKey: alert.subjectKey,
          entityId: inherited.entityId,
          disposition: 'CLEARED',
          // The analyst's own words are carried forward verbatim. The ledger
          // must show what this clearance actually rests on.
          rationale: `Auto-cleared from prior decision ${inherited.id} by ${inherited.decidedBy}: ${inherited.rationale}`,
          decidedBy: 'system:memory-recall',
          agentAssisted: true,
          agentReasoning: {
            inheritedFrom: inherited.id,
            inheritedAt: inherited.decidedAt,
            matchedEntities: matching.map((c) => c.entityId),
            evidenceUnchanged: true,
          },
        });
        await appendToolStep(investigation.id, {
          tool: 'propose_disposition',
          input: { disposition: 'CLEARED', source: 'memory' },
          output: { decisionId: decision.id, inheritedFrom: inherited.id },
        });
        await setInvestigationState(investigation.id, 'DONE');
        await setAlertStatus(alert.id, 'CLEARED');

        outcome.kind = 'AUTO_CLEARED';
        outcome.decision = decision;
        outcome.inheritedFrom = inherited.id;
        outcome.steps++;
        return outcome;
      }
    }

    // --- Step 3: agent loop ---------------------------------------------
    await setInvestigationState(investigation.id, 'REASONING');
    const llm = options.llm ?? getLLMProvider();
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: describeAlert(alert, matching, recalled) },
    ];

    for (let step = 0; step < maxSteps; step++) {
      const response = await llm.generate(messages, TOOL_DEFINITIONS);
      outcome.steps++;

      if (response.toolUses.length === 0) {
        // The model ended its turn without proposing. Hand to a human rather
        // than inventing a disposition.
        break;
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolUses: response.toolUses,
      });

      const results: ToolResult[] = [];
      let proposed = false;

      for (const use of response.toolUses) {
        if (use.name === 'propose_disposition') {
          const proposal = parseProposal(use.input);
          outcome.proposal = proposal;
          await appendToolStep(investigation.id, {
            tool: use.name,
            input: use.input,
            output: { accepted: true },
          });
          proposed = true;
          break;
        }

        const { output, error } = await runTool(use.name, use.input, context);
        await appendToolStep(investigation.id, {
          tool: use.name,
          input: use.input,
          output: error ? { error } : summarise(use.name, output),
        });
        results.push({
          toolUseId: use.id,
          content: error ? { error } : output,
          isError: error !== null,
        });
      }

      if (proposed) break;
      messages.push({ role: 'user', content: '', toolResults: results });
    }

    // --- Step 4: hand to a human ----------------------------------------
    //
    // The agent NEVER writes a final disposition to the ledger. Not for HIT,
    // and not for CLEARED either: a fresh clearance is a human judgement, and
    // auto-clear is only permitted above, where it inherits a decision a human
    // already made on unchanged evidence. This is a compliance requirement,
    // not a preference.
    await setInvestigationState(investigation.id, 'AWAITING_HUMAN');
    await setAlertStatus(
      alert.id,
      outcome.proposal?.disposition === 'HIT' ? 'ESCALATED' : 'INVESTIGATING',
    );
    outcome.kind = 'AWAITING_HUMAN';
    return outcome;
  } catch (err) {
    // Degradation path: a throttled or failing model must leave a recoverable
    // investigation, never a corrupt one. The trace written so far is intact,
    // the alert returns to the human queue, and nothing is written to the
    // ledger.
    const message = err instanceof Error ? err.message : String(err);
    outcome.kind = 'FAILED';
    outcome.error = message;

    await appendToolStep(investigation.id, {
      tool: 'error',
      input: null,
      output: {
        message,
        retryable: err instanceof ProviderUnavailableError ? err.retryable : false,
      },
    }).catch(() => {
      /* the trace is best-effort at this point; the alert state below matters more */
    });
    await setInvestigationState(investigation.id, 'AWAITING_HUMAN').catch(() => {});
    await setAlertStatus(alert.id, 'OPEN').catch(() => {});
    return outcome;
  }
}

/**
 * A prior CLEARED decision may be inherited only when the evidence has not
 * changed — that is, every entity now matching was already covered by a prior
 * adjudication for this subject.
 *
 * If the subject now matches an entity nobody has ever looked at, this is a
 * new question and gets a fresh investigation. Anything looser would let a
 * genuine hit inherit an unrelated clearance, which is the one failure mode
 * that must not happen: a false auto-clear is a compliance breach, a false
 * escalation is merely work.
 *
 * Note that DOB and nationality are already baked into `subject_key`, so a
 * namesake with a different date of birth never reaches this function.
 */
export function findInheritableClearance(
  recalled: readonly Decision[],
  matching: readonly Candidate[],
): Decision | null {
  if (recalled.length === 0) return null;

  const adjudicated = new Set(
    recalled.map((d) => d.entityId).filter((id): id is string => id !== null),
  );
  const everyMatchSeenBefore = matching.every((c) => adjudicated.has(c.entityId));
  if (!everyMatchSeenBefore) return null;

  // Newest first from recallPriorDecisions. A later HIT or ESCALATED
  // supersedes an earlier clearance, so scan in order and stop at the first
  // decision rather than hunting for a convenient CLEARED.
  const latest = recalled[0]!;
  return latest.disposition === 'CLEARED' ? latest : null;
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<{ output: unknown; error: string | null }> {
  try {
    switch (name) {
      case 'search_watchlist':
        return { output: await searchWatchlist(input, context), error: null };
      case 'recall_prior_decisions':
        return { output: await recallPriorDecisionsTool(input, context), error: null };
      case 'get_counterparty_history':
        return { output: await getCounterpartyHistory(input, context), error: null };
      case 'compare_identifiers':
        return { output: await compareIdentifiers(input, context), error: null };
      default:
        return { output: null, error: `unknown tool: ${name}` };
    }
  } catch (err) {
    // A tool failure is reported back to the model, which may recover by
    // trying something else. It does not abort the investigation.
    return { output: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Keep the persisted trace readable; full candidate arrays belong in the DB. */
function summarise(tool: string, output: unknown): unknown {
  if (tool === 'search_watchlist') {
    const candidates = (output as { candidates: Candidate[] }).candidates;
    return {
      candidateCount: candidates.length,
      top: candidates.slice(0, 5).map((c) => ({
        entityId: c.entityId,
        variantText: c.variantText,
        distance: Number(c.distance.toFixed(4)),
      })),
    };
  }
  return output;
}

function describeAlert(
  alert: Alert,
  matching: readonly Candidate[],
  recalled: readonly Decision[],
): string {
  const lines = [
    'ALERT',
    `  Subject:      ${alert.subjectName}`,
    `  Date of birth:${alert.subjectDob ? ` ${alert.subjectDob}` : ' not provided'}`,
    `  Nationality:  ${alert.subjectNat ?? 'not provided'}`,
    `  Jurisdiction: ${alert.jurisdiction}`,
    `  Transaction:  ${alert.txnRef ?? 'n/a'} ${alert.txnNarration ?? ''}`.trimEnd(),
    '',
    `MATCHING WATCHLIST CANDIDATES (${matching.length})`,
    ...matching
      .slice(0, 10)
      .map(
        (c) =>
          `  ${c.distance.toFixed(4)}  ${c.primaryName}  [${c.sourceList} ${c.sourceRef}]  matched variant: ${c.variantText} (${c.variantKind})`,
      ),
  ];

  if (recalled.length > 0) {
    lines.push('', `PRIOR DECISIONS FOR THIS SUBJECT (${recalled.length})`);
    for (const decision of recalled.slice(0, 5)) {
      lines.push(
        `  ${decision.decidedAt.toISOString().slice(0, 10)}  ${decision.disposition}  by ${decision.decidedBy}`,
        `    "${decision.rationale}"`,
      );
    }
  } else {
    lines.push('', 'PRIOR DECISIONS FOR THIS SUBJECT: none. This subject has not been adjudicated before.');
  }

  lines.push('', 'Investigate and propose a disposition.');
  return lines.join('\n');
}

/**
 * The human disposition. This is the ONLY path by which a HIT reaches the
 * ledger.
 *
 * The rationale is embedded so that a future screen of the same subject can
 * recall not merely the outcome but the reasoning — which is the asset that
 * currently walks out of the building when an analyst resigns.
 */
export async function disposeByAnalyst(input: {
  alert: Alert;
  disposition: Disposition;
  rationale: string;
  decidedBy: string;
  entityId?: string | null;
  agentReasoning?: unknown;
}): Promise<Decision> {
  if (input.rationale.trim().length === 0) {
    throw new Error('a disposition requires a rationale: it is the durable asset');
  }
  const embedder = getEmbeddingProvider();
  const [rationaleVec] = await embedder.embed([input.rationale]);

  const decision = await recordDecision({
    alertId: input.alert.id,
    subjectKey: input.alert.subjectKey,
    entityId: input.entityId ?? null,
    disposition: input.disposition,
    rationale: input.rationale,
    rationaleVec,
    decidedBy: input.decidedBy,
    agentAssisted: input.agentReasoning !== undefined,
    agentReasoning: input.agentReasoning,
  });

  await setAlertStatus(input.alert.id, input.disposition);
  return decision;
}
