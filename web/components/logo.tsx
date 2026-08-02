/**
 * The Sifta wordmark.
 *
 * Not a picture of the logo — the logo itself, as its modules. The grid below
 * was extracted from `Sifta logo.png` (18 × 5 modules, navy #1D2A5E, amber
 * #F4A624, which are the `--navy-700` and `--amber` tokens) so the mark in the
 * product and the mark in the file are the same object.
 *
 * Drawn rather than embedded for three reasons that matter here: it stays
 * sharp at 16px in the nav and at 200px on the hero, it inherits the theme
 * (navy modules invert in dark mode, amber never does), and it is literally
 * built from the same square module as the Field — which is the brief's whole
 * §0 thesis. A raster would look like a logo pasted onto the product; this is
 * the product's own grid spelling its name.
 *
 *   N = navy module   A = amber module   . = empty
 */
const GRID = [
  'NNN.A..NN..N......',
  'N......N...N..NNN.',
  'NAN.N.NAN.NAN.N...',
  '..N.N..N...N..NNN.',
  'NNN.N..N...NN....A',
] as const;

const COLS = 18;
const ROWS = 5;
const UNIT = 10;
/** Hairline between modules — §1.1, the grid is visible, not implied. */
const INSET = 0.5;

export interface LogoProps {
  /** Rendered height in px. Width follows the 18:5 module ratio. */
  height?: number;
  /**
   * Render the five amber modules in amber.
   *
   * True on the marketing page, where the mark is the brand and its amber
   * squares are the argument (§0). False in the console chrome, where amber
   * is reserved for a live match and a permanently amber logo in the nav
   * would spend the one signal an analyst scans for (§1.2).
   */
  accent?: boolean;
  title?: string;
}

export function Logo({ height = 24, accent = false, title = 'Sifta' }: LogoProps) {
  const width = (height * COLS) / ROWS;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${COLS * UNIT} ${ROWS * UNIT}`}
      role="img"
      aria-label={title}
      style={{ display: 'block' }}
    >
      {GRID.flatMap((row, y) =>
        [...row].map((cell, x) => {
          if (cell === '.') return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * UNIT + INSET}
              y={y * UNIT + INSET}
              width={UNIT - INSET * 2}
              height={UNIT - INSET * 2}
              fill={cell === 'A' && accent ? 'var(--amber)' : 'currentColor'}
            />
          );
        }),
      )}
    </svg>
  );
}
