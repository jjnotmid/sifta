/**
 * Mirrors `DEFAULT_MATCH_THRESHOLD` in `src/screening/index.ts`.
 *
 * The console renders amber at exactly the distance the engine calls a match,
 * so what an analyst sees is what the engine decided. If the two ever drift,
 * the Field is lying about the screen. Kept as a single named constant here
 * rather than repeated per page for that reason.
 */
export const MATCH_THRESHOLD = 0.9;
