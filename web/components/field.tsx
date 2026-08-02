'use client';

import { useEffect, useMemo, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/use-in-view';

/**
 * The Field — SIFTA-DESIGN-BRIEF.md §5.
 *
 * The logo, alive. Every candidate the vector search returned is one module in
 * a grid; the ones the agent rules out go hollow, left to right; the surviving
 * match snaps to amber.
 *
 * Three states, and only three:
 *   candidate  filled navy-500   — returned by the search, not yet judged
 *   cleared    hollow            — ruled out; the grid visibly drains
 *   match      amber             — a hit. Nothing else in this product is amber.
 *
 * Motion is mechanical (§7): 240ms to populate, 120ms per state change, one
 * easing curve, no stagger that reads as decorative. Under
 * `prefers-reduced-motion` the Field renders its final state on the first
 * frame — the animation is a nicety, the information is not.
 */

export type CellState = 'candidate' | 'cleared' | 'match';

export interface FieldCell {
  /** The name variant this module stands for. Shown on hover, in mono. */
  label: string;
  /** L2 distance from the subject. Shown on hover, in mono. */
  distance: number;
  state: CellState;
}

export interface FieldProps {
  cells: FieldCell[];
  /** Columns in the grid. Defaults to 16, as in the brief's diagram. */
  columns?: number;
  /** Module edge in px. Multiples of the 8px base only. */
  size?: number;
  /**
   * Skip the populate/resolve sequence and paint the final state. Used by the
   * memory comparison, where the prior screen is history and animating it
   * would imply it is happening now.
   */
  static?: boolean;
  label?: string;
}

type Phase = 'empty' | 'populated' | 'resolved';

export function Field({
  cells,
  columns = 16,
  size = 16,
  static: isStatic = false,
  label,
}: FieldProps) {
  const reduced = usePrefersReducedMotion();
  // Populate when the grid is actually on screen. Playing the one animation
  // the product is remembered by while it sits below the fold wastes it.
  const { ref, inView } = useInView<HTMLDivElement>();
  const skip = isStatic || reduced;
  const [phase, setPhase] = useState<Phase>(skip ? 'resolved' : 'empty');

  useEffect(() => {
    if (skip) {
      setPhase('resolved');
      return;
    }
    if (!inView) return;
    setPhase('empty');
    // Populate, then resolve. Two steps, no per-cell stagger: the grid fills
    // mechanically, the way a scan completes, not the way a hero animates.
    const toPopulated = window.setTimeout(() => setPhase('populated'), 40);
    const toResolved = window.setTimeout(() => setPhase('resolved'), 40 + 240);
    return () => {
      window.clearTimeout(toPopulated);
      window.clearTimeout(toResolved);
    };
  }, [skip, inView, cells]);

  const matches = useMemo(() => cells.filter((c) => c.state === 'match').length, [cells]);

  return (
    <div ref={ref}>
      {label ? (
        <div
          className="t-label muted"
          style={{ marginBottom: 'var(--s-2)', display: 'flex', justifyContent: 'space-between' }}
        >
          <span>{label}</span>
          <span className="t-data-sm" style={{ color: matches > 0 ? 'var(--amber)' : undefined }}>
            {cells.length} candidates · {matches} match{matches === 1 ? '' : 'es'}
          </span>
        </div>
      ) : null}

      <div
        role="img"
        aria-label={`${cells.length} candidates screened, ${matches} matching`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, ${size}px)`,
          gap: 4,
        }}
      >
        {cells.map((cell, i) => (
          <Module key={`${cell.label}-${i}`} cell={cell} index={i} size={size} phase={phase} />
        ))}
      </div>
    </div>
  );
}

function Module({
  cell,
  index,
  size,
  phase,
}: {
  cell: FieldCell;
  index: number;
  size: number;
  phase: Phase;
}) {
  const [hover, setHover] = useState(false);

  // Before resolution every module reads as an undifferentiated candidate.
  // The judgement is the thing being animated, so it must not leak early.
  const shown: CellState = phase === 'resolved' ? cell.state : 'candidate';

  const style: React.CSSProperties = {
    width: size,
    height: size,
    position: 'relative',
    transition: `background-color var(--t-state) var(--ease), border-color var(--t-state) var(--ease), opacity var(--t-grid) var(--ease)`,
    opacity: phase === 'empty' ? 0 : 1,
    // Ruled-out modules resolve left to right (§5.2). The delay is a function
    // of position, so the drain reads as a sweep rather than a twinkle.
    transitionDelay: phase === 'resolved' ? `${Math.min(index * 6, 180)}ms` : '0ms',
    border: '1px solid transparent',
    background: 'transparent',
  };

  if (shown === 'candidate') {
    style.background = 'var(--navy-500)';
    style.borderColor = 'var(--navy-500)';
  } else if (shown === 'match') {
    style.background = 'var(--amber)';
    style.borderColor = 'var(--amber)';
  } else {
    // Hollow. Outline only — the analyst sees their progress as the grid drains.
    style.background = 'transparent';
    style.borderColor = 'var(--cleared)';
  }

  return (
    <div
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      tabIndex={0}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {hover ? <Tooltip cell={cell} /> : null}
    </div>
  );
}

/** Hard-edged, mono, no shadow — §5.4. */
function Tooltip({ cell }: { cell: FieldCell }) {
  return (
    <div
      className="t-data-sm"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        zIndex: 20,
        background: 'var(--navy-900)',
        color: 'var(--paper)',
        border: '1px solid var(--navy-700)',
        padding: '4px 8px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      <div>{cell.label}</div>
      <div style={{ color: cell.state === 'match' ? 'var(--amber)' : 'var(--navy-300)' }}>
        d={cell.distance.toFixed(4)} · {cell.state}
      </div>
    </div>
  );
}
