import { QueueTable } from '@/components/queue-table';
import { MATCH_THRESHOLD } from '@/lib/constants';
import { getTotals, listAlerts } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const [alerts, totals] = await Promise.all([listAlerts(), getTotals()]);

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
          Alert queue
        </h1>
        <p className="t-data-sm muted" style={{ margin: 0 }}>
          {totals.open} open · {totals.decisions} dispositioned ·{' '}
          {totals.entities.toLocaleString()} entities screened against
        </p>
      </header>

      <p className="t-label muted" style={{ marginBottom: 'var(--s-3)' }}>
        j / k move · enter open · c clear · e escalate
      </p>

      <QueueTable alerts={alerts} matchThreshold={MATCH_THRESHOLD} />
    </main>
  );
}
