import { alertsForSubject } from '../memory/alerts.js';
import { recallPriorDecisions } from '../memory/decisions.js';
import { getEntity } from '../memory/watchlist.js';
import type { Alert, Candidate, Decision, Disposition } from '../memory/types.js';
import { normalizeName, subjectKey } from '../normalize.js';
import { screenSubject } from '../screening/index.js';
import type { ToolDef } from '../providers/types.js';

/**
 * The agent's tools, exactly as named in PRD §7.
 *
 * Each is a plain async function over the memory layer. The LLM never touches
 * the database directly — it selects a tool and supplies arguments, and the
 * loop executes it and records the call in the investigation's tool trace.
 * That indirection is what makes the trace a complete, replayable account of
 * how a decision was reached, which is what an analyst shows a regulator.
 */

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'search_watchlist',
    description:
      'Vector candidate generation over watchlist name variants. Returns ranked candidates with match distances. Use this first to establish who the subject might be.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Subject name as written on the transaction.' },
        limit: { type: 'integer', description: 'Maximum candidates to return (default 20).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'recall_prior_decisions',
    description:
      'Retrieve prior adjudications for this subject: what was decided, by whom, and the analyst rationale. Check this before conducting a fresh investigation — the institution may already have cleared this person.',
    inputSchema: {
      type: 'object',
      properties: {
        subject_key: {
          type: 'string',
          description: 'Normalised subject identity. Omit to derive it from the alert.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_counterparty_history',
    description:
      'Prior alerts and transaction narrations involving this subject, newest first. Use to establish whether the transaction pattern is consistent with an existing customer.',
    inputSchema: {
      type: 'object',
      properties: {
        subject_key: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'compare_identifiers',
    description:
      'Structured comparison of the subject against a specific watchlist entity: date of birth, nationality, and name overlap. This is the evidence an analyst disposes on.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Watchlist entity to compare against.' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'propose_disposition',
    description:
      'Record your recommendation and reasoning. This is a PROPOSAL reviewed by a human analyst, never a final decision. A HIT proposal always routes to human review.',
    inputSchema: {
      type: 'object',
      properties: {
        disposition: {
          type: 'string',
          enum: ['CLEARED', 'HIT', 'ESCALATED'],
        },
        rationale: {
          type: 'string',
          description:
            'Why, in plain language, citing the specific evidence. This text is durable and is what a future investigation will recall.',
        },
        entity_id: {
          type: 'string',
          description: 'The watchlist entity this disposition concerns, if any.',
        },
        confidence: { type: 'number', description: '0 to 1.' },
      },
      required: ['disposition', 'rationale'],
    },
  },
];

export interface ToolContext {
  alert: Alert;
  /** Candidates from the initial screen, reused by compare_identifiers. */
  candidates: Candidate[];
}

export interface IdentifierComparison {
  entityId: string;
  listedName: string;
  dobMatch: 'match' | 'mismatch' | 'unknown';
  nationalityMatch: 'match' | 'mismatch' | 'unknown';
  sharedNameTokens: string[];
  subjectDob: string | null;
  listedDob: string | null;
  subjectNationality: string | null;
  listedNationality: string | null;
}

export interface DispositionProposal {
  disposition: Disposition;
  rationale: string;
  entityId: string | null;
  confidence: number | null;
}

export async function searchWatchlist(
  input: { name?: unknown; limit?: unknown },
  context: ToolContext,
): Promise<{ candidates: Candidate[] }> {
  const name = typeof input.name === 'string' ? input.name : context.alert.subjectName;
  const limit = typeof input.limit === 'number' ? input.limit : 20;
  const result = await screenSubject({
    name,
    dob: context.alert.subjectDob,
    nationality: context.alert.subjectNat,
    limit,
  });
  context.candidates = result.candidates;
  return { candidates: result.candidates };
}

export async function recallPriorDecisionsTool(
  input: { subject_key?: unknown },
  context: ToolContext,
): Promise<{ decisions: Decision[] }> {
  const key =
    typeof input.subject_key === 'string' && input.subject_key.length > 0
      ? input.subject_key
      : context.alert.subjectKey;
  return { decisions: await recallPriorDecisions(key) };
}

export async function getCounterpartyHistory(
  input: { subject_key?: unknown; limit?: unknown },
  context: ToolContext,
): Promise<{
  alerts: { id: string; txnRef: string | null; narration: string | null; status: string; raisedAt: string }[];
}> {
  const key =
    typeof input.subject_key === 'string' && input.subject_key.length > 0
      ? input.subject_key
      : context.alert.subjectKey;
  const limit = typeof input.limit === 'number' ? input.limit : 20;
  const prior = await alertsForSubject(key, limit);
  return {
    alerts: prior
      .filter((a) => a.id !== context.alert.id)
      .map((a) => ({
        id: a.id,
        txnRef: a.txnRef,
        narration: a.txnNarration,
        status: a.status,
        raisedAt: a.raisedAt.toISOString(),
      })),
  };
}

export async function compareIdentifiers(
  input: { entity_id?: unknown },
  context: ToolContext,
): Promise<IdentifierComparison> {
  const entityId = typeof input.entity_id === 'string' ? input.entity_id : '';
  const entity = await getEntity(entityId);
  if (!entity) throw new Error(`compare_identifiers: no watchlist entity ${entityId}`);

  const { alert } = context;
  const subjectTokens = new Set(normalizeName(alert.subjectName).split(' ').filter(Boolean));
  const listedTokens = normalizeName(entity.primaryName).split(' ').filter(Boolean);

  return {
    entityId,
    listedName: entity.primaryName,
    // 'unknown' is a distinct outcome from 'mismatch' and must stay that way:
    // OFAC frequently publishes no DOB at all, and treating absent evidence as
    // exculpatory is how a real hit gets cleared.
    dobMatch: compare(alert.subjectDob, entity.dob),
    nationalityMatch: compare(
      alert.subjectNat ? normalizeName(alert.subjectNat) : null,
      entity.nationality ? normalizeName(entity.nationality) : null,
    ),
    sharedNameTokens: listedTokens.filter((t) => subjectTokens.has(t)),
    subjectDob: alert.subjectDob,
    listedDob: entity.dob,
    subjectNationality: alert.subjectNat,
    listedNationality: entity.nationality,
  };
}

function compare(a: string | null, b: string | null): 'match' | 'mismatch' | 'unknown' {
  if (!a || !b) return 'unknown';
  return a === b ? 'match' : 'mismatch';
}

export function parseProposal(input: Record<string, unknown>): DispositionProposal {
  const disposition = input.disposition;
  if (disposition !== 'CLEARED' && disposition !== 'HIT' && disposition !== 'ESCALATED') {
    throw new Error(
      `propose_disposition: disposition must be CLEARED, HIT or ESCALATED; got ${JSON.stringify(disposition)}`,
    );
  }
  const rationale = input.rationale;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new Error('propose_disposition: a rationale is required');
  }
  return {
    disposition,
    rationale: rationale.trim(),
    entityId: typeof input.entity_id === 'string' ? input.entity_id : null,
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
  };
}

/** Derive the normalised identity for an alert-shaped subject. */
export function keyForSubject(
  name: string,
  dob?: string | null,
  nationality?: string | null,
): string {
  return subjectKey(name, dob, nationality);
}
