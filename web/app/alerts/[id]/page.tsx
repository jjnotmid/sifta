import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Disconnected } from '@/components/disconnected';
import { DispositionPanel } from '@/components/disposition-panel';
import { MATCH_THRESHOLD } from '@/lib/constants';
import { Field, type FieldCell } from '@/components/field';
import { MemoryComparison } from '@/components/memory-comparison';
import {
  getAlert,
  getCandidates,
  getInvestigation,
  getPriorDecisions,
  type CandidateRow,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Investigation view — SIFTA-DESIGN-BRIEF.md §9.
 *
 * Two columns. Left: subject and the Field. Right: the agent's reasoning
 * trace as a timestamped mono log, then prior decisions beneath it — the
 * memory payoff, which the brief says to give room. Disposition controls
 * pinned bottom-right.
 */
export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = await getAlert(id);
  if (!found.ok) {
    return (
      <main className="shell" style={{ paddingTop: 'var(--s-5)' }}>
        <Disconnected reason={found.reason} />
      </main>
    );
  }
  const alert = found.data;
  if (!alert) notFound();

  const [candidates, investigation, priors] = await Promise.all([
    getCandidates(id),
    getInvestigation(id),
    getPriorDecisions(alert.subject_key, id),
  ]);

  const cells = toCells(candidates);
  const prior = priors[0] ?? null;

  return (
    <main className="shell" style={{ paddingTop: 'var(--s-5)', paddingBottom: 'var(--s-8)' }}>
      <Link href="/queue" className="t-label muted">
        ← Queue
      </Link>

      <header style={{ margin: 'var(--s-3) 0 var(--s-5)' }}>
        <h1 className="t-h1" style={{ margin: 0 }}>
          {alert.subject_name}
        </h1>
        <p className="t-data-sm muted" style={{ margin: 'var(--s-1) 0 0' }}>
          {alert.subject_key}
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
        {/* ---- Left: subject and the Field ---------------------------- */}
        <section>
          <div className="panel" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="panel-head">
              <span className="t-label">Subject</span>
              <span className="t-data-sm muted">{alert.jurisdiction}</span>
            </div>
            <div className="panel-body">
              <Facts
                rows={[
                  ['Name', alert.subject_name],
                  ['Date of birth', alert.subject_dob ?? 'unknown'],
                  ['Nationality', alert.subject_nat ?? 'unknown'],
                  ['Transaction', alert.txn_ref ?? '—'],
                ]}
              />
              {alert.txn_narration ? (
                <p className="t-data" style={{ marginTop: 'var(--s-3)', marginBottom: 0 }}>
                  {alert.txn_narration}
                </p>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="t-label">Field</span>
              <span className="t-data-sm muted">
                {candidates.length} candidates · threshold {MATCH_THRESHOLD.toFixed(2)}
              </span>
            </div>
            <div className="panel-body">
              {cells.length > 0 ? (
                <Field cells={cells} />
              ) : (
                <p className="muted t-data-sm" style={{ margin: 0 }}>
                  No candidate set recorded. The investigation has not run for this alert.
                </p>
              )}
            </div>
          </div>

          {alert.matched_name ? (
            <div className="panel" style={{ marginTop: 'var(--s-4)' }}>
              <div className="panel-head">
                <span className="t-label">Matched entity</span>
                <span
                  className="t-data-sm"
                  style={{
                    color:
                      alert.match_distance !== null &&
                      Number(alert.match_distance) <= MATCH_THRESHOLD
                        ? 'var(--amber)'
                        : 'var(--navy-300)',
                  }}
                >
                  d={alert.match_distance === null ? '—' : Number(alert.match_distance).toFixed(4)}
                </span>
              </div>
              <div className="panel-body">
                <p className="t-data" style={{ margin: 0 }}>
                  {alert.matched_name}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {/* ---- Right: trace, memory, disposition ----------------------- */}
        <section>
          <div className="panel" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="panel-head">
              <span className="t-label">Agent trace</span>
              <span className="t-data-sm muted">
                {investigation ? `${investigation.state.toLowerCase()} · ${investigation.step_count} steps` : 'not run'}
              </span>
            </div>
            <div
              className="panel-body"
              style={{ maxHeight: 360, overflowY: 'auto', background: 'var(--navy-900)' }}
            >
              <TraceLog steps={investigation?.tool_trace ?? []} />
            </div>
          </div>

          {/* The memory payoff. Given room, per §9. */}
          <div className="panel" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="panel-head">
              <span className="t-label">Prior decisions</span>
              <span className="t-data-sm muted">{priors.length} on this subject</span>
            </div>
            <div className="panel-body">
              {prior ? (
                <>
                  <MemoryComparison
                    current={cells}
                    prior={cells.map((c) => ({ ...c, state: 'cleared' as const }))}
                    priorDecidedAt={formatDate(prior.decided_at)}
                    priorDisposition={titleCase(prior.disposition)}
                    priorDecidedBy={prior.decided_by}
                  />
                  <div style={{ marginTop: 'var(--s-4)' }}>
                    {priors.map((decision) => (
                      <div
                        key={decision.id}
                        style={{
                          borderTop: '1px solid var(--rule)',
                          paddingTop: 'var(--s-2)',
                          marginTop: 'var(--s-2)',
                        }}
                      >
                        <div className="t-data-sm muted">
                          {titleCase(decision.disposition)} · {decision.decided_by} ·{' '}
                          {formatDate(decision.decided_at)}
                        </div>
                        <p className="t-data" style={{ margin: 'var(--s-1) 0 0' }}>
                          {decision.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted t-data-sm" style={{ margin: 0 }}>
                  No prior decisions for this subject. The next screen of this person will inherit
                  whatever you record below.
                </p>
              )}
            </div>
          </div>

          <DispositionPanel
            alertId={alert.id}
            status={alert.status}
            suggestedRationale={proposalFrom(investigation?.tool_trace ?? [])}
          />
        </section>
      </div>
    </main>
  );
}

/**
 * Candidates become modules. A candidate inside the match threshold is amber;
 * everything the search returned and the distance ruled out goes hollow.
 */
function toCells(candidates: CandidateRow[]): FieldCell[] {
  return candidates.map((candidate) => {
    const distance = Number(candidate.distance);
    return {
      label: `${candidate.variantText}  ·  ${candidate.primaryName}`,
      distance,
      state: distance <= MATCH_THRESHOLD ? ('match' as const) : ('cleared' as const),
    };
  });
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
      {rows.map(([term, value]) => (
        <div key={term} style={{ display: 'contents' }}>
          <dt className="t-label muted">{term}</dt>
          <dd className="t-data" style={{ margin: 0 }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TraceLog({ steps }: { steps: { step: number; tool: string; output: unknown; at: string }[] }) {
  if (steps.length === 0) {
    return (
      <p className="t-data-sm" style={{ margin: 0, color: 'var(--navy-300)' }}>
        No trace recorded.
      </p>
    );
  }

  return (
    <div className="t-data-sm" style={{ color: 'var(--paper)' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 'var(--s-2)', padding: '2px 0' }}>
          <span style={{ color: 'var(--navy-300)', minWidth: 62 }}>
            {String(step.at ?? '').slice(11, 19)}
          </span>
          <span style={{ color: 'var(--navy-300)', minWidth: 20, textAlign: 'right' }}>
            {step.step ?? i + 1}
          </span>
          <span style={{ minWidth: 176 }}>{step.tool}</span>
          <span style={{ color: 'var(--navy-300)', wordBreak: 'break-all' }}>
            {summarise(step.output)}
          </span>
        </div>
      ))}
    </div>
  );
}

function summarise(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output.slice(0, 160);
  const json = JSON.stringify(output);
  return json.length > 160 ? `${json.slice(0, 160)}…` : json;
}

function proposalFrom(steps: { tool: string; input: unknown }[]): string | null {
  const proposal = [...steps].reverse().find((s) => s.tool === 'propose_disposition');
  if (!proposal) return null;
  const input = proposal.input as { rationale?: string; disposition?: string } | null;
  if (!input?.rationale) return null;
  return input.disposition ? `${titleCase(input.disposition)} — ${input.rationale}` : input.rationale;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
