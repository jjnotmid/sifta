'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Fire once when an element first becomes visible.
 *
 * Used to start the permitted animations when the reader actually reaches
 * them, rather than on page load where they play to an empty screen. This is
 * not the fade-up-on-scroll pattern the brief bans (§6): nothing moves, fades
 * or translates on scroll — a counter starts counting and a grid fills, both
 * of which §7 permits, and each happens exactly once.
 */
export function useInView<T extends HTMLElement>(rootMargin = '-80px'): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (or a test environment): show the final state.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

/** §7: reduced motion means the final state, immediately. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
