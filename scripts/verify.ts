/**
 * Check that a Sifta install is actually working.
 *
 * Written to be run by someone who has just cloned the repo and followed the
 * README, and who needs to know which step they are on rather than which
 * stack trace they got. Every check reports pass, fail, or skip with the
 * command that fixes it.
 *
 * Exits non-zero if any required check fails, so it works as a gate.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Status = 'pass' | 'fail' | 'skip';

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const checks: Check[] = [];

function record(name: string, status: Status, detail: string, fix?: string): void {
  checks.push({ name, status, detail, ...(fix ? { fix } : {}) });
  const mark = status === 'pass' ? '  ok  ' : status === 'skip' ? ' skip ' : ' FAIL ';
  console.log(`[${mark}] ${name.padEnd(34)} ${detail}`);
  if (status === 'fail' && fix) console.log(`         → ${fix}`);
}

async function main(): Promise<void> {
  console.log('Verifying Sifta\n');

  // --- Toolchain --------------------------------------------------------
  const major = Number(process.versions.node.split('.')[0]);
  record(
    'Node.js >= 20',
    major >= 20 ? 'pass' : 'fail',
    `v${process.versions.node}`,
    'Install Node 20 or newer.',
  );

  record(
    'Dependencies installed',
    existsSync(`${ROOT}node_modules`) ? 'pass' : 'fail',
    existsSync(`${ROOT}node_modules`) ? 'node_modules present' : 'node_modules missing',
    'npm install',
  );

  // --- Database ---------------------------------------------------------
  let dbUp = false;
  try {
    const { getPool, closePool } = await import('../src/memory/pool.js');
    const { rows } = await getPool().query<{ v: string }>('SELECT version() AS v');
    dbUp = true;
    record('Database reachable', 'pass', (rows[0]?.v ?? '').split(' ').slice(0, 2).join(' '));

    const counts = await getPool().query<{
      entities: number;
      variants: number;
      alerts: number;
      decisions: number;
    }>(
      `SELECT (SELECT count(*)::int FROM watchlist_entity) AS entities,
              (SELECT count(*)::int FROM name_variant)     AS variants,
              (SELECT count(*)::int FROM alert)            AS alerts,
              (SELECT count(*)::int FROM decision)         AS decisions`,
    );
    const c = counts.rows[0]!;

    record(
      'Watchlist ingested',
      Number(c.entities) > 10_000 ? 'pass' : 'fail',
      `${Number(c.entities).toLocaleString()} entities (need > 10,000)`,
      'npm run ingest:ofac',
    );
    record(
      'Name variants generated',
      Number(c.variants) > Number(c.entities) ? 'pass' : 'fail',
      `${Number(c.variants).toLocaleString()} variants`,
      'npm run ingest:variants',
    );
    record(
      'Demo queue seeded',
      Number(c.alerts) > 0 ? 'pass' : 'skip',
      `${Number(c.alerts)} alerts, ${Number(c.decisions)} decisions`,
      'npm run seed:demo   (optional — only needed to see the console populated)',
    );

    await closePool();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(
      'Database reachable',
      'fail',
      message.slice(0, 70),
      'npm run db:up && npm run migrate',
    );
  }

  // --- Committed snapshots the deployed site depends on ------------------
  for (const [file, script] of [
    ['web/data/eval-headline.json', 'npm run eval && npm run eval:snapshot'],
    ['web/data/worked-example.json', 'npm run eval:example'],
    ['web/data/field-example.json', 'npm run eval:field'],
  ] as const) {
    record(
      `Snapshot ${file.split('/').pop()}`,
      existsSync(`${ROOT}${file}`) ? 'pass' : 'fail',
      existsSync(`${ROOT}${file}`) ? 'present' : 'missing',
      script,
    );
  }

  // --- Code -------------------------------------------------------------
  await step('Typecheck', ['run', 'typecheck'], 'npm run typecheck');
  await step('Tests', ['run', 'test'], 'npm test');

  record(
    'Console dependencies',
    existsSync(`${ROOT}web/node_modules`) ? 'pass' : 'fail',
    existsSync(`${ROOT}web/node_modules`) ? 'web/node_modules present' : 'missing',
    'npm --prefix web install',
  );

  if (!dbUp) {
    record(
      'Console database config',
      'skip',
      'no cluster to point at',
      'See README step 3.',
    );
  } else {
    const hasEnv = existsSync(`${ROOT}web/.env.local`) || Boolean(process.env.DATABASE_URL);
    record(
      'Console database config',
      hasEnv ? 'pass' : 'fail',
      hasEnv ? 'DATABASE_URL available to the console' : 'web/.env.local missing',
      "echo 'DATABASE_URL=postgresql://root@localhost:26257/sifta?sslmode=disable' > web/.env.local",
    );
  }

  // --- Summary ----------------------------------------------------------
  const failed = checks.filter((c) => c.status === 'fail');
  const skipped = checks.filter((c) => c.status === 'skip');

  console.log(
    `\n${checks.length - failed.length - skipped.length} passed, ` +
      `${failed.length} failed, ${skipped.length} skipped`,
  );

  if (failed.length > 0) {
    console.log('\nDo these, in order:');
    for (const check of failed) console.log(`  ${check.fix ?? check.name}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nReady. Start the console:  npm run web:dev   → http://localhost:3000');
}

async function step(name: string, args: string[], fix: string): Promise<void> {
  try {
    await run('npm', args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    record(name, 'pass', 'exit 0');
  } catch (err) {
    const out = String((err as { stdout?: string }).stdout ?? '')
      .trim()
      .split('\n')
      .slice(-1)[0];
    record(name, 'fail', (out ?? 'failed').slice(0, 70), fix);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
