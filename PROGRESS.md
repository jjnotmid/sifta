# Sifta — build progress

Append-only build log. One entry per phase, written after that phase's exit gate
passes.

---

## Phase 0 — Scaffold

**Gate:** `npm run typecheck && npm test` → exit 0 ✅

**Built**

- Repository initialised (git, MIT `LICENSE` at repo root — hackathon Stage One
  is pass/fail on this file being visible).
- TypeScript project: Node 20+ ESM, `strict` plus `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`. `noEmit` for typecheck;
  `tsx` for execution.
- Vitest configured against `tests/**/*.test.ts` with `fileParallelism: false`
  — database-backed suites share a single local cluster, so serial files keep
  schema state deterministic.
- `docker-compose.yml` for local single-node CockroachDB v25.2.0.
- `.env.example` documenting every variable, with working local defaults for
  everything except cloud credentials.
- Directory skeleton per PRD §7: `db/`, `src/{providers,memory,agent,mcp,ingest,screening,eval,lambda}`,
  `web/`, `docs/`, `data/`, `tests/`.

**Files created**

```
LICENSE  package.json  tsconfig.json  vitest.config.ts
.gitignore  .env.example  docker-compose.yml
PROGRESS.md  BLOCKERS.md
tests/scaffold.test.ts
```

**Deferred / noted**

- Docker is not installed on the build machine. Phase 1 adds `scripts/db-up.sh`,
  which falls back to a downloaded CockroachDB binary and produces an identical
  cluster on `localhost:26257`. `docker-compose.yml` is kept as the documented
  path for contributors who do have Docker. See `BLOCKERS.md` #1.
- Node on the build machine is v26, not v20. Nothing in the toolchain is
  version-pinned below the Lambda runtime; the Lambda bundle still targets
  Node 20.
