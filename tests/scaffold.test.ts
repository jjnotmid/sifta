import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Phase 0 gate. These assert the things a hackathon submission is
 * disqualified for getting wrong, so they are worth a real test rather than a
 * one-time manual check.
 */
describe('scaffold', () => {
  it('ships an MIT LICENSE at the repository root', async () => {
    const license = await readFile(`${repoRoot}LICENSE`, 'utf8');
    expect(license).toContain('MIT License');
    expect(license).toContain('Usifoh Joshua');
  });

  it('declares itself an ESM package on Node 20 or newer', async () => {
    const pkg = JSON.parse(await readFile(`${repoRoot}package.json`, 'utf8')) as {
      type: string;
      license: string;
      engines: { node: string };
    };
    expect(pkg.type).toBe('module');
    expect(pkg.license).toBe('MIT');
    expect(pkg.engines.node).toBe('>=20');
  });

  it('does not commit secrets: .env is gitignored, .env.example is not', async () => {
    const ignored = await readFile(`${repoRoot}.gitignore`, 'utf8');
    const lines = ignored.split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines).not.toContain('.env.example');
  });
});
