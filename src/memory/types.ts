export type SourceList = 'OFAC_SDN' | 'UN' | 'EU' | 'UK_OFSI';

export type VariantKind =
  | 'primary'
  | 'aka'
  | 'reordered'
  | 'deaccented'
  | 'translit'
  | 'shortened'
  | 'initialised'
  | 'dropped';

export type AlertStatus = 'OPEN' | 'INVESTIGATING' | 'CLEARED' | 'HIT' | 'ESCALATED';

export type Disposition = 'CLEARED' | 'HIT' | 'ESCALATED';

export type InvestigationState =
  | 'PENDING'
  | 'GATHERING'
  | 'REASONING'
  | 'AWAITING_HUMAN'
  | 'DONE';

export interface WatchlistEntity {
  id: string;
  sourceList: SourceList;
  sourceRef: string;
  jurisdiction: string;
  primaryName: string;
  dob: string | null;
  nationality: string | null;
  rawPayload: unknown;
}

export interface WatchlistEntityInput {
  sourceList: SourceList;
  sourceRef: string;
  jurisdiction: string;
  primaryName: string;
  dob?: string | null;
  nationality?: string | null;
  aliases?: string[];
  rawPayload?: unknown;
}

export interface NameVariantInput {
  entityId: string;
  jurisdiction: string;
  variantText: string;
  variantKind: VariantKind;
  embedding?: readonly number[] | null;
}

export interface Candidate {
  entityId: string;
  variantId: string;
  variantText: string;
  variantKind: VariantKind;
  primaryName: string;
  dob: string | null;
  nationality: string | null;
  sourceList: string;
  sourceRef: string;
  distance: number;
}

export interface AlertInput {
  subjectName: string;
  subjectKey: string;
  subjectDob?: string | null;
  subjectNat?: string | null;
  jurisdiction: string;
  txnRef?: string | null;
  txnNarration?: string | null;
  narrationVec?: readonly number[] | null;
  matchedEntity?: string | null;
  matchDistance?: number | null;
  status?: AlertStatus;
}

export interface Alert {
  id: string;
  subjectName: string;
  subjectKey: string;
  subjectDob: string | null;
  subjectNat: string | null;
  jurisdiction: string;
  txnRef: string | null;
  txnNarration: string | null;
  matchedEntity: string | null;
  matchDistance: number | null;
  status: AlertStatus;
  raisedAt: Date;
}

export interface DecisionInput {
  alertId: string;
  subjectKey: string;
  entityId?: string | null;
  disposition: Disposition;
  rationale: string;
  rationaleVec?: readonly number[] | null;
  decidedBy: string;
  agentAssisted?: boolean;
  agentReasoning?: unknown;
}

export interface Decision {
  id: string;
  alertId: string;
  subjectKey: string;
  entityId: string | null;
  disposition: Disposition;
  rationale: string;
  decidedBy: string;
  agentAssisted: boolean;
  agentReasoning: unknown;
  decidedAt: Date;
}

export interface ToolTraceStep {
  step: number;
  tool: string;
  input: unknown;
  output: unknown;
  at: string;
}

export interface Investigation {
  id: string;
  alertId: string;
  state: InvestigationState;
  stepCount: number;
  toolTrace: ToolTraceStep[];
  updatedAt: Date;
}
