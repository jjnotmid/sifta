'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { dispositionAlert } from '@/app/actions';
import type { AlertRow } from '@/lib/queries';

/**
 * Alert queue — SIFTA-DESIGN-BRIEF.md §9.
 *
 * Dense table, 40px rows, hairline rules, sticky header, no zebra striping.
 * Amber left-edge marker on rows with a live match.
 *
 * Keyboard: j/k move, Enter opens, c clears, e escalates. The brief is
 * explicit that these are not a flourish — analysts live in this queue all
 * day, and reaching for the mouse on every row is the difference between a
 * tool and a demo.
 *
 * `c` and `e` do not disposition immediately. They open a rationale prompt,
 * because a disposition without the analyst's words is worth nothing to the
 * next screen of the same subject — and inventing that text would be
 * fabricating a compliance record.
 */

const ANALYST = 'analyst@demo';

interface Props {
  alerts: AlertRow[];
  matchThreshold: number;
}

export function QueueTable({ alerts, matchThreshold }: Props) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<{ disposition: 'CLEARED' | 'ESCALATED' } | null>(null);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(
    (index: number) => {
      const alert = alerts[index];
      if (alert) router.push(`/alerts/${alert.id}`);
    },
    [alerts, router],
  );

  const submit = useCallback(() => {
    const alert = alerts[cursor];
    if (!alert || !pending) return;
    setError(null);
    startTransition(async () => {
      const result = await dispositionAlert({
        alertId: alert.id,
        disposition: pending.disposition,
        rationale,
        decidedBy: ANALYST,
      });
      if (result.ok) {
        setPending(null);
        setRationale('');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [alerts, cursor, pending, rationale, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // While the rationale prompt is open it owns the keyboard, or typing a
      // word containing 'c' would fire another disposition.
      if (pending) {
        if (event.key === 'Escape') {
          setPending(null);
          setRationale('');
          setError(null);
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'j':
          event.preventDefault();
          setCursor((c) => Math.min(c + 1, alerts.length - 1));
          break;
        case 'k':
          event.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          open(cursor);
          break;
        case 'c':
          event.preventDefault();
          setPending({ disposition: 'CLEARED' });
          break;
        case 'e':
          event.preventDefault();
          setPending({ disposition: 'ESCALATED' });
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alerts.length, cursor, open, pending]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  if (alerts.length === 0) {
    // §8: state the situation. No exclamation mark, no emoji.
    return (
      <p className="muted" style={{ padding: 'var(--s-6) 0' }}>
        Queue empty. Run <code className="t-data">npm run seed:demo</code> to raise alerts from
        the ingested OFAC list.
      </p>
    );
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr className="t-label muted">
            <th style={{ width: 32 }} />
            <th>Subject</th>
            <th>Matched entity</th>
            <th>Juris.</th>
            <th style={{ textAlign: 'right' }}>Distance</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Prior</th>
            <th style={{ textAlign: 'right' }}>Raised</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert, i) => {
            const distance = alert.match_distance === null ? null : Number(alert.match_distance);
            const isLiveMatch =
              distance !== null &&
              distance <= matchThreshold &&
              (alert.status === 'OPEN' || alert.status === 'INVESTIGATING');
            const dispositioned =
              alert.status === 'CLEARED' || alert.status === 'HIT' || alert.status === 'ESCALATED';

            return (
              <tr
                key={alert.id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onClick={() => {
                  setCursor(i);
                  open(i);
                }}
                className={isLiveMatch ? 'is-hit' : undefined}
                style={{
                  cursor: 'pointer',
                  background: i === cursor ? 'var(--rule)' : undefined,
                  borderLeft: isLiveMatch ? '4px solid var(--amber)' : '4px solid transparent',
                  transition: 'background var(--t-state) var(--ease)',
                }}
              >
                <td className="t-data-sm muted" style={{ textAlign: 'right' }}>
                  {i === cursor ? '▸' : ''}
                </td>
                <td className="t-data" style={{ color: dispositioned ? 'var(--cleared)' : undefined }}>
                  {alert.subject_name}
                </td>
                <td className="t-data" style={{ color: 'var(--navy-300)' }}>
                  {alert.matched_name ?? '—'}
                </td>
                <td className="t-data-sm muted">{alert.jurisdiction}</td>
                <td
                  className="t-data"
                  style={{
                    textAlign: 'right',
                    color: isLiveMatch ? 'var(--amber)' : undefined,
                  }}
                >
                  {distance === null ? '—' : distance.toFixed(4)}
                </td>
                <td className="t-label" style={{ color: statusColor(alert.status) }}>
                  {alert.status.toLowerCase()}
                </td>
                <td className="t-data" style={{ textAlign: 'right' }}>
                  {alert.prior_decisions > 0 ? alert.prior_decisions : ''}
                </td>
                <td className="t-data-sm muted" style={{ textAlign: 'right' }}>
                  {formatDate(alert.raised_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pending ? (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--paper)',
            borderTop: '1px solid var(--ink)',
            zIndex: 30,
          }}
        >
          <div className="shell" style={{ padding: 'var(--s-3) var(--s-4)' }}>
            <div className="t-label" style={{ marginBottom: 'var(--s-2)' }}>
              {pending.disposition === 'CLEARED' ? 'Clear alert' : 'Escalate alert'} —{' '}
              <span className="t-data">{alerts[cursor]?.subject_name}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
              <input
                ref={inputRef}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') {
                    setPending(null);
                    setRationale('');
                  }
                }}
                placeholder="Why? This is the record a regulator reads."
                className="t-data"
                style={{
                  flex: 1,
                  height: 32,
                  padding: '0 var(--s-2)',
                  border: '1px solid var(--ink)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                }}
              />
              <button className="btn btn-primary" onClick={submit} disabled={isPending}>
                {isPending ? 'Recording' : 'Record'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setPending(null);
                  setRationale('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {error ? (
              <p className="t-data-sm" style={{ color: 'var(--amber)', marginTop: 'var(--s-2)' }}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function statusColor(status: string): string | undefined {
  if (status === 'HIT') return 'var(--amber)';
  if (status === 'CLEARED') return 'var(--cleared)';
  return 'var(--navy-300)';
}

function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
