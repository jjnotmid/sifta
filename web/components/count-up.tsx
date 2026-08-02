'use client';

import { useEffect, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/use-in-view';

/**
 * A number that counts to its value when it comes into view.
 *
 * §7 permits exactly three animations, and this is one of them: "a numeric
 * counter ticking". It is mechanical — the number counts, nothing moves,
 * fades, scales or bounces — which is the distinction the brief draws between
 * motion that reports state and motion that decorates.
 *
 * The count is deliberately not eased into a slow crawl at the end. It runs on
 * the same cubic-bezier(0.2, 0, 0, 1) as everything else: fast, then a hard
 * stop on the real figure.
 */

const DURATION = 900;

/** The shared easing curve, as a function. Fast out, hard stop. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(value);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      setShown(Math.round(ease(t) * value));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown.toLocaleString()}
    </span>
  );
}
