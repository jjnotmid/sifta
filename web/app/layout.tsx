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
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
