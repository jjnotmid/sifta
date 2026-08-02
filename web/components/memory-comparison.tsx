'use client';

import { Field, type FieldCell } from './field';

/**
 * The two-Field memory comparison — SIFTA-DESIGN-BRIEF.md §5, second use.
 *
 * Today's screen beside the same subject's prior screen, with the
 * previously-cleared cells already hollow. The second grid is mostly empty,
 * and that emptiness is the whole argument: the institution already did this
 * work, and Sifta did not make the analyst do it twice.
 *
 * The prior grid never animates. It is a record of a screen that already
 * happened; animating it would imply it is running now.
 */

export interface MemoryComparisonProps {
  current: FieldCell[];
  prior: FieldCell[];
  priorDecidedAt: string;
  priorDisposition: string;
  priorDecidedBy: string;
}

export function MemoryComparison({
  current,
  prior,
  priorDecidedAt,
  priorDisposition,
  priorDecidedBy,
}: MemoryComparisonProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--s-4)',
        alignItems: 'start',
      }}
    >
      <div>
        <Field cells={current} label="This screen" />
      </div>
      <div style={{ borderLeft: '1px solid var(--rule)', paddingLeft: 'var(--s-4)' }}>
        <Field cells={prior} label="Prior screen" static />
        <div className="t-data-sm muted" style={{ marginTop: 'var(--s-2)' }}>
          {priorDisposition} by {priorDecidedBy} · {priorDecidedAt}
        </div>
      </div>
    </div>
  );
}
