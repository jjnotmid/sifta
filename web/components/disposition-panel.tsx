'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { dispositionAlert } from '@/app/actions';
import type { Disposition } from '@/lib/queries';

const ANALYST = 'analyst@demo';

/**
 * Disposition controls — pinned bottom-right of the investigation view (§9).
 *
 * The agent proposes; the human disposes. There is no control here that lets
 * the agent's proposal become a decision on its own: the analyst types the
 * rationale and presses the button, every time. That is a compliance
 * requirement, not a preference (PRD §7), and the UI is where it becomes
 * visible to the person doing the work.
 *
 * Actions keep the same word through the whole flow (§8): the button says
 * Clear alert, the ledger says Cleared.
 */
export function DispositionPanel({
  alertId,
  status,
  suggestedRationale,
}: {
  alertId: string;
  status: string;
  suggestedRationale?: string | null;
}) {
  const router = useRouter();
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decided = status === 'CLEARED' || status === 'HIT' || status === 'ESCALATED';

  function record(disposition: Disposition) {
    setError(null);
    startTransition(async () => {
      const result = await dispositionAlert({ alertId, disposition, rationale, decidedBy: ANALYST });
      if (result.ok) {
        setRationale('');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (decided) {
    return (
      <div className="panel" style={{ borderColor: 'var(--ink)' }}>
        <div className="panel-body">
          <div className="t-label muted">Disposition</div>
          <div className="t-h3" style={{ marginTop: 'var(--s-1)' }}>
            {status === 'CLEARED' ? 'Cleared' : status === 'HIT' ? 'Hit' : 'Escalated'}
          </div>
          <p className="t-data-sm muted" style={{ margin: 'var(--s-2) 0 0' }}>
            Recorded in the ledger. Decisions are append-only and cannot be edited.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ borderColor: 'var(--ink)' }}>
      <div className="panel-head">
        <span className="t-label">Disposition</span>
        <span className="t-data-sm muted">You decide</span>
      </div>
      <div className="panel-body">
        {suggestedRationale ? (
          <div style={{ marginBottom: 'var(--s-3)' }}>
            <div className="t-label muted">Agent proposal</div>
            <p className="t-data" style={{ margin: 'var(--s-1) 0 0' }}>
              {suggestedRationale}
            </p>
          </div>
        ) : null}

        <label className="t-label muted" htmlFor="rationale">
          Your rationale
        </label>
        <textarea
          id="rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={4}
          placeholder="What did you verify, and what did it show?"
          className="t-data"
          style={{
            width: '100%',
            marginTop: 'var(--s-1)',
            padding: 'var(--s-2)',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
          <button className="btn btn-primary" disabled={isPending} onClick={() => record('CLEARED')}>
            Clear alert
          </button>
          <button className="btn" disabled={isPending} onClick={() => record('ESCALATED')}>
            Escalate
          </button>
          <button className="btn" disabled={isPending} onClick={() => record('HIT')}>
            Confirm hit
          </button>
        </div>

        {error ? (
          <p className="t-data-sm" style={{ color: 'var(--amber)', marginTop: 'var(--s-2)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
