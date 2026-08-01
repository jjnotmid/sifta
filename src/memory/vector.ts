import { EMBEDDING_DIMENSIONS } from '../config.js';

/**
 * CockroachDB's VECTOR type is pgvector-compatible on the wire: it accepts and
 * returns the literal form `[1,2,3]`. `pg` has no type parser registered for
 * it, so values arrive as strings and must be sent as strings.
 */

export function encodeVector(values: readonly number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `expected a ${EMBEDDING_DIMENSIONS}-dimension vector, got ${values.length}`,
    );
  }
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new Error(`vector contains a non-finite value: ${v}`);
    }
  }
  return `[${values.join(',')}]`;
}

export function decodeVector(raw: string | null): number[] | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`malformed vector literal: ${raw.slice(0, 40)}`);
  }
  const body = trimmed.slice(1, -1);
  if (body.length === 0) return [];
  return body.split(',').map((part) => {
    const n = Number(part);
    if (Number.isNaN(n)) throw new Error(`malformed vector component: ${part}`);
    return n;
  });
}
