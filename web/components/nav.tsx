'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The wordmark is set in the same square modules the Field is built from —
 * §0: the logo is the data visualization. The mark is navy only. Amber never
 * appears in a logo lockup (§1.2).
 */
function Mark() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 6px)', gap: 2 }}>
        {[1, 1, 1, 1, 0, 1, 1, 1, 1].map((on, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              background: on ? 'var(--navy-700)' : 'transparent',
              border: on ? 'none' : '1px solid var(--rule)',
            }}
          />
        ))}
      </span>
      <span
        style={{
          fontWeight: 800,
          fontStretch: 'expanded',
          letterSpacing: '-0.01em',
          fontSize: 18,
        }}
      >
        Sifta
      </span>
    </span>
  );
}

const LINKS = [
  { href: '/queue', label: 'Queue' },
  { href: '/ledger', label: 'Ledger' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <Link href="/" style={{ color: 'var(--ink)' }}>
          <Mark />
        </Link>
        <span style={{ flex: 1 }} />
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`t-label ${pathname.startsWith(link.href) ? 'active' : ''}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
