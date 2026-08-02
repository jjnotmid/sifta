/**
 * Shown when the console cannot read the cluster.
 *
 * §8: state what happened and what to do; do not apologise. A deployed
 * instance with no database behind it is a configuration fact, and naming it
 * on the page is more useful than a 500 whose cause lives in a log the reader
 * cannot open.
 */
export function Disconnected({ reason }: { reason: string }) {
  return (
    <div className="panel" style={{ borderColor: 'var(--ink)' }}>
      <div className="panel-head">
        <span className="t-label">No database</span>
      </div>
      <div className="panel-body">
        <p className="t-data" style={{ marginTop: 0 }}>
          {reason}
        </p>
        <p className="t-body" style={{ color: 'var(--navy-500)' }}>
          The console reads a live CockroachDB cluster; it holds no data of its own. Set{' '}
          <code className="t-data">DATABASE_URL</code> to a reachable cluster and reload.
        </p>
        <p className="t-data-sm muted" style={{ marginBottom: 0 }}>
          Locally: <code className="t-data-sm">npm run db:up &amp;&amp; npm run migrate &amp;&amp;
          npm run ingest:ofac &amp;&amp; npm run ingest:variants &amp;&amp; npm run seed:demo</code>
        </p>
      </div>
    </div>
  );
}
