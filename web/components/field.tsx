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
 * ## The sequence
 *
 * §5 describes three distinct beats — the grid populates, cells are ruled out
 * left to right, the survivor snaps to amber — and the first implementation
 * collapsed them into about 460ms, which is below the threshold at which a
 * person can see three things happen in order. It was technically animating
 * and effectively static.
 *
 * Each beat now gets its own duration, and each individual module still moves
 * on the brief's timings: 240ms to fill, 120ms per state change, one easing
 * curve. What is staged is the *order*, which is the information — a screen
 * resolving is the product working, and it should be legible as three steps.
 *
 *   fill      modules arrive left to right          ~500ms
 *   hold      the full candidate set, undifferentiated  400ms
 *   rule out  ruled-out modules drain, left to right   ~700ms
 *   match     the survivor snaps to amber              120ms
 *
 * Nothing floats, fades in from an offset, scales, or bounces. Modules appear
 * and change colour. Under `prefers-reduced-motion` the final state is painted
 * on the first frame.
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
   * Skip the sequence and paint the final state. Used by the memory
   * comparison, where the prior screen is history and animating it would
   * imply it is happening now.
   */
  static?: boolean;
  /**
   * Replay the sequence continuously.
   *
   * Marketing hero only — §9 says "Hero is the Field, animating", in the
   * present continuous. A visitor who scrolls in after a one-shot play would
   * otherwise arrive at a still grid and never see the product work. Console
   * Fields never loop: an analyst is reading evidence, not watching a demo.
   */
  loop?: boolean;
  label?: string;
}

type Phase = 'empty' | 'filling' | 'holding' | 'ruling' | 'resolved';

const FILL_MS = 500;
const HOLD_MS = 400;
const RULE_MS = 700;
const REPLAY_GAP_MS = 2200;

export function Field({
  cells,
  columns = 16,
  size = 16,
  static: isStatic = false,
  loop = false,
  label,
}: FieldProps) {
  const reduced = usePrefersReducedMotion();
  // Run when the grid is actually on screen. Playing the one animation the
  // product is remembered by while it sits below the fold wastes it.
  const { ref, inView } = useInView<HTMLDivElement>();
  const skip = isStatic || reduced;
  const [phase, setPhase] = useState<Phase>(skip ? 'resolved' : 'empty');

  useEffect(() => {
    if (skip) {
      setPhase('resolved');
      return;
    }
    if (!inView) return;

    const timers: number[] = [];

    const run = () => {
      setPhase('empty');
      timers.push(window.setTimeout(() => setPhase('filling'), 30));
      timers.push(window.setTimeout(() => setPhase('holding'), 30 + FILL_MS));
      timers.push(window.setTimeout(() => setPhase('ruling'), 30 + FILL_MS + HOLD_MS));
      timers.push(
        window.setTimeout(() => setPhase('resolved'), 30 + FILL_MS + HOLD_MS + RULE_MS),
      );
    };

    run();

    let interval = 0;
    if (loop) {
      const cycle = 30 + FILL_MS + HOLD_MS + RULE_MS + REPLAY_GAP_MS;
      interval = window.setInterval(run, cycle);
    }

    return () => {
      timers.forEach(window.clearTimeout);
      if (interval) window.clearInterval(interval);
    };
  }, [skip, inView, loop, cells]);

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
          <Module
            key={`${cell.label}-${i}`}
            cell={cell}
            index={i}
            total={cells.length}
            size={size}
            phase={phase}
          />
        ))}
      </div>
    </div>
  );
}

function Module({
  cell,
  index,
  total,
  size,
  phase,
}: {
  cell: FieldCell;
  index: number;
  total: number;
  size: number;
  phase: Phase;
}) {
  const [hover, setHover] = useState(false);

  // Position through the grid, so both sweeps run left to right at a pace set
  // by the number of modules rather than a hardcoded per-cell delay.
  const progress = total <= 1 ? 0 : index / (total - 1);

  const visible = phase !== 'empty';
  // A module only reveals its verdict once the ruling beat reaches it. Before
  // that every module reads as an undifferentiated candidate — the judgement
  // is the thing being animated, so it must not leak early.
  const ruled = phase === 'ruling' || phase === 'resolved';
  const shown: CellState = ruled ? cell.state : 'candidate';

  const style: React.CSSProperties = {
    width: size,
    height: size,
    position: 'relative',
    opacity: visible ? 1 : 0,
    transition:
      'opacity var(--t-grid) var(--ease), background-color var(--t-state) var(--ease), border-color var(--t-state) var(--ease)',
    transitionDelay:
      phase === 'filling'
        ? `${Math.round(progress * FILL_MS)}ms`
        : phase === 'ruling'
          ? // The match resolves last, after every rejection has landed.
            cell.state === 'match'
            ? `${RULE_MS}ms`
            : `${Math.round(progress * RULE_MS)}ms`
          : '0ms',
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
