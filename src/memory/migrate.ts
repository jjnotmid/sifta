import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_DIMENSIONS } from '../config.js';
import { closePool, getPool } from './pool.js';

const SCHEMA_PATH = fileURLToPath(new URL('../../db/schema.sql', import.meta.url));

/** Tables carrying a vector column, and the column to verify the width of. */
const VECTOR_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['name_variant', 'embedding'],
  ['alert', 'narration_vec'],
  ['decision', 'rationale_vec'],
];

/**
 * Split a SQL script into statements.
 *
 * Deliberately small rather than a real parser: it only needs to survive the
 * constructs db/schema.sql actually uses — `--` line comments and single-quoted
 * strings. A naive `split(';')` would break on a semicolon inside a comment,
 * which this file has.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inLineComment = false;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      current += ch;
      continue;
    }
    if (inString) {
      current += ch;
      // '' is an escaped quote inside a string, not a terminator.
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  statements.push(current);

  return statements
    .map((s) => stripComments(s).trim())
    .filter((s) => s.length > 0);
}

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === "'") inString = !inString;
        if (!inString && ch === '-' && line[i + 1] === '-') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/**
 * Rewrite every VECTOR(n) literal to the configured width.
 *
 * This is what makes EMBEDDING_DIMENSIONS the single source of truth: the
 * schema file stays readable with a concrete 1024, and switching embedding
 * providers does not require editing it.
 */
export function applyEmbeddingDimensions(sql: string, dimensions: number): string {
  return sql.replace(/\bVECTOR\s*\(\s*\d+\s*\)/gi, `VECTOR(${dimensions})`);
}

/** True when the error is CockroachDB telling us the object already exists. */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  // 42P07 duplicate_table, 42710 duplicate_object, 42P16 invalid_table_definition
  return code === '42P07' || code === '42710';
}

export interface MigrateResult {
  statementsApplied: number;
  dimensions: number;
}

export async function migrate(): Promise<MigrateResult> {
  const raw = await readFile(SCHEMA_PATH, 'utf8');
  const sql = applyEmbeddingDimensions(raw, EMBEDDING_DIMENSIONS);
  const statements = splitStatements(sql);
  const pool = getPool();

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
      // IF NOT EXISTS covers the tables, but GRANT/REVOKE and role creation
      // are not uniformly idempotent across versions. Swallow only
      // "already exists"; anything else is a real migration failure.
      if (isAlreadyExists(err)) continue;
      const head = statement.split('\n').slice(0, 3).join(' ').slice(0, 120);
      throw new Error(
        `migration failed on statement: ${head}…\n  ${(err as Error).message}`,
      );
    }
  }

  await assertVectorWidths(EMBEDDING_DIMENSIONS);
  return { statementsApplied: statements.length, dimensions: EMBEDDING_DIMENSIONS };
}

/**
 * CREATE TABLE IF NOT EXISTS silently skips a table that already exists, so
 * changing EMBEDDING_DIMENSIONS against an existing database would otherwise
 * leave columns at the old width and fail much later, at insert time, with a
 * confusing error. Fail here instead, with the fix in the message.
 */
async function assertVectorWidths(expected: number): Promise<void> {
  const pool = getPool();
  for (const [table, column] of VECTOR_COLUMNS) {
    const { rows } = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM [SHOW COLUMNS FROM ${table}] WHERE column_name = $1`,
      [column],
    );
    const dataType = rows[0]?.data_type;
    if (!dataType) throw new Error(`${table}.${column} is missing after migration`);

    const found = /\((\d+)\)/.exec(dataType);
    const actual = found ? Number(found[1]) : null;
    if (actual !== expected) {
      throw new Error(
        `${table}.${column} is ${dataType} but EMBEDDING_DIMENSIONS=${expected}.\n` +
          `The table pre-dates the current setting. Drop and re-migrate:\n` +
          `  npm run db:reset && npm run migrate`,
      );
    }
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  migrate()
    .then(({ statementsApplied, dimensions }) => {
      console.log(
        `migrate: applied ${statementsApplied} statements at VECTOR(${dimensions})`,
      );
      return closePool();
    })
    .catch(async (err: Error) => {
      console.error(`migrate: ${err.message}`);
      await closePool();
      process.exit(1);
    });
}
