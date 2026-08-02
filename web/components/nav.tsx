'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './logo';

const LINKS = [
  { href: '/queue', label: 'Queue' },
  { href: '/ledger', label: 'Ledger' },
];

export function Nav() {
  const pathname = usePathname();

  // Full-colour mark on the marketing page, navy-only in the console. Amber
  // in the console means one thing — a live match — and a permanently amber
  // logo sitting above the queue all day spends exactly the signal an analyst
  // is scanning for (§1.2).
  const isConsole = pathname.startsWith('/queue') || pathname.startsWith('/ledger') || pathname.startsWith('/alerts');

  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <Link href="/" style={{ color: 'var(--navy-700)', display: 'flex' }} aria-label="Sifta home">
          <Logo height={20} accent={!isConsole} />
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
