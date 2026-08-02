import Link from 'next/link';
import { listDecisions } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Decision ledger — SIFTA-DESIGN-BRIEF.md §9.
 *
 * Mono throughout, deliberately austere. It should look like a record, not a
 * dashboard: no charts, no summary tiles, no colour except the one amber a
 * confirmed hit earns.
 *
 * Append-only is a property of the database (the `sifta_app` role has no
 * UPDATE or DELETE on this table), which is why this page has no edit
 * affordance to hide — there is nothing it could offer.
 */
export default async function LedgerPage() {
  const decisions = await listDecisions();

  return (
    <main className="shell" style={{ paddingTop: 'var(--s-5)', paddingBottom: 'var(--s-8)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--s-4)',
        }}
      >
        <h1 className="t-h1" style={{ margin: 0 }}>
          Decision ledger
        </h1>
        <p className="t-data-sm muted" style={{ margin: 0 }}>
          {decisions.length} record{decisions.length === 1 ? '' : 's'} · append-only
        </p>
      </header>

      {decisions.length === 0 ? (
        <p className="muted" style={{ padding: 'var(--s-6) 0' }}>
          No decisions recorded. Dispositioning an alert writes here permanently.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr className="t-label muted">
              <th>Decided</th>
              <th>Subject</th>
              <th>Disposition</th>
              <th>By</th>
              <th>Rationale</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {decisions.map((decision) => (
              <tr key={decision.id}>
                <td className="t-data-sm muted">{formatDate(decision.decided_at)}</td>
                <td className="t-data">{decision.subject_name ?? decision.subject_key}</td>
                <td
                  className="t-data"
                  style={{
                    color:
                      decision.disposition === 'HIT'
                        ? 'var(--amber)'
                        : decision.disposition === 'CLEARED'
                          ? 'var(--cleared)'
                          : undefined,
                  }}
                >
                  {titleCase(decision.disposition)}
                </td>
                <td className="t-data-sm muted">{decision.decided_by}</td>
                <td
                  className="t-data"
                  style={{
                    whiteSpace: 'normal',
                    maxWidth: 560,
                    paddingTop: 'var(--s-1)',
                    paddingBottom: 'var(--s-1)',
                  }}
                >
                  {decision.rationale}
                </td>
                <td className="t-data-sm">
                  <Link href={`/alerts/${decision.alert_id}`} className="muted">
                    open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
