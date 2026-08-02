import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/nav';

/**
 * Two families, no more (§3). Archivo for display and UI, IBM Plex Mono for
 * anything a compliance officer might read aloud to a regulator.
 *
 * Explicitly not Inter — §3 calls it out as the default every generated
 * interface reaches for.
 */
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
  weight: ['400', '600', '700', '800'],
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '600'],
});

export const metadata: Metadata = {
  title: 'Sifta',
  description:
    'Screening and investigation memory for African financial institutions. ' +
    'Every decision an analyst makes is retained and reused.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` covers this element's own attributes only —
    // not its children, so a genuine markup mismatch anywhere in the app still
    // reports normally.
    //
    // It is here because browser extensions write to <html> before React
    // hydrates. A crypto-wallet extension adding `data-bybit-channel-name` to
    // the tag is indistinguishable, to React, from the server and client
    // disagreeing. Nothing in this app renders anything on <html> that could
    // differ between the two: the className is two build-time font variables.
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
