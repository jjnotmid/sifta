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

---

## Phase 0.5 — Relocated off iCloud Drive

Not a planned phase. The repo was created in an iCloud Drive folder, where
`npm install` took 4 minutes against 5 seconds on local disk, and a CockroachDB
store inside a sync root risks file eviction mid-write.

The project now lives at `~/Projects/sifta` with full git history. The
CockroachDB binary and its data directory live in `~/.sifta` (override with
`SIFTA_HOME`), deliberately outside the repo.

---

## Phase 1 — Schema and database layer

**Gate:** `npm run db:up && npm run migrate && npm test -- memory` → exit 0 ✅
(15 tests). Docker substitution per `BLOCKERS.md` #1.

**Built**

- `db/schema.sql` — the five tables from PRD §7 covering all four memory
  layers, every vector index declared **inline** and **prefix-partitioned**
  (`name_variant` and `alert` by `jurisdiction`, `decision` by `subject_key`).
- **Append-only ledger enforced by the database, not by convention.** A
  least-privilege `sifta_app` login holds `SELECT, INSERT` on `decision` and
  nothing else; `UPDATE`/`DELETE` are revoked. Tests assert both are rejected
  with SQLSTATE 42501 and that the row survives. Root is used only for
  migrations.
- `src/memory/migrate.ts` — idempotent runner with a small SQL splitter that
  survives semicolons inside comments. Rewrites every `VECTOR(n)` literal from
  the single `EMBEDDING_DIMENSIONS` constant in `src/config.ts`, then verifies
  the applied column widths actually match and fails with the fix in the
  message if the database pre-dates a dimension change.
- `src/memory/` — typed access layer per table: `watchlist`, `variants`,
  `alerts`, `decisions`, `investigations`. No ORM, `pg` only.
- `insertVariants` refuses chunks above `MAX_VECTOR_INSERT_CHUNK = 10`, so the
  "never batch vector inserts" rule is enforced in code rather than remembered.
- `appendToolStep` appends to `tool_trace` inside the `UPDATE` via jsonb
  concatenation rather than read-modify-write, so a crash mid-loop cannot lose
  or duplicate a trace step.
- `src/normalize.ts` — `subjectKey()` sorts name tokens, so "Joshua Usifoh" and
  "Usifoh Joshua" collapse to one key. This is the hinge the memory recall
  depends on.
- `src/providers/types.ts` + `mock.ts` — built early because the Phase 1 tests
  need deterministic embeddings. `MockEmbeddingProvider` is a real
  character-trigram hashing embedder, not noise: similar names land near each
  other in L2 space, so tests and the Phase 4 eval measure something
  meaningful.

**Verified against the live cluster (CockroachDB v25.4.0)**

`EXPLAIN` on the candidate query returns:

```
• vector search
    table: name_variant@name_vec_idx
    target count: 20
    prefix spans: [/'NG' - /'NG']
```

`prefix spans: [/'NG' - /'NG']` is the proof that a Nigerian screen scans only
the Nigerian partition rather than the global index. This is the plan to show
on camera. Asserted in `tests/memory/schema.test.ts`, not just observed once.

**Files created**

```
db/schema.sql
scripts/db-up.sh  scripts/db-down.sh
src/config.ts  src/normalize.ts
src/memory/{pool,vector,migrate,types,watchlist,variants,alerts,decisions,investigations,index}.ts
src/providers/{types,mock}.ts
tests/helpers/db.ts  tests/memory/schema.test.ts
```

**Deferred**

- `narration_vec` and `rationale_vec` are written and indexed but nothing
  searches them yet; Phase 5 uses them for rationale recall.
- Real embedding providers land in Phase 6. Everything runs on the mock until
  then, by design.

---

## Phase 2 — Watchlist ingestion

**Gate:** `npm run ingest:ofac && npm test -- ingest` → exit 0, database holds
**19,181** entities (> 10,000 required) ✅

**Built**

- `src/ingest/ofac.ts` — parser for the real OFAC SDN XML from the Sanctions
  List Service. Publication of 30 July 2026: 19,181 records, all 19,181 parsed,
  none dropped.
- `src/ingest/download.ts` — cached, redirect-following downloader. Writes to
  `<dest>.part` and renames on success so an interrupted transfer can never
  masquerade as a valid cache.
- `src/ingest/ingest-ofac.ts` + `cli-ofac.ts` — idempotent load. Entities
  upsert on `(source_list, source_ref)`, variants on
  `(entity_id, variant_text, variant_kind)`, so a daily re-publish updates in
  place. **43,399** name variants written (one `primary` per entity plus one
  `aka` per alias).
- `scripts/make-fixture.ts` — carves a 46-record fixture out of the real
  download, selected to include the awkward shapes rather than the first N:
  Nigerian/Ghanaian/Kenyan nationals, full DOBs, fuzzy DOBs, missing DOB and
  nationality, alias-heavy records, and non-individuals. Every byte is genuine
  OFAC data.

**Judgement calls**

- **Fuzzy dates are dropped, not guessed.** OFAC DOBs are free text
  (`"1957"`, `"circa 1960"`, `"01 Jan 1980 to 31 Dec 1980"`). Only an
  unambiguous full date becomes a `DATE`. Inventing `1957-01-01` from `"1957"`
  would manufacture a DOB mismatch that is not in the source — and DOB mismatch
  is precisely what analysts clear alerts on.
- **Non-individuals are ingested, not filtered.** PRD §9 scopes *entity
  resolution* to individuals, which is honoured in Phase 3 (only individuals
  get generated name variants). But an AML tool that silently omits 9,840
  sanctioned companies and 1,524 vessels from the watchlist would be
  non-compliant, so all 19,181 records are loaded and screenable by their
  primary name and aliases.

**⚠ Design issue found — jurisdiction partitioning**

Deriving `jurisdiction` from each entity's own nationality yields
`GLOBAL=19,125  NG=29  KE=25  GH=2`. OFAC lists very few African nationals.

A screen scoped to `jurisdiction = 'NG'` would therefore check 29 entities and
miss the other 19,152 — fast, demo-friendly, and completely non-compliant. A
Nigerian fintech screens against the *entire* list.

Resolution carried into Phase 4: the jurisdiction prefix is a **locality
optimisation on the vector index, not a compliance filter.** Screening scans
every partition and merges the ranked results; the single-partition `EXPLAIN`
still demonstrates that the prefix bounds the scan. This is written up in
`ARCHITECTURE.md` rather than glossed over, because the PRD's phrasing ("a
Nigerian screen searches only the Nigerian partition") reads as a correctness
claim and, against real OFAC data, it is not one.

**Files created**

```
src/ingest/{ofac,download,ingest-ofac,cli-ofac}.ts
scripts/make-fixture.ts
tests/fixtures/sdn-sample.xml   tests/ingest/ofac.test.ts
```

**Network note**

The Sanctions List Service 302s to an S3 bucket in `us-gov-west-1` that the
build machine's resolver could not resolve. `download.ts` falls back to public
DNS (1.1.1.1 / 8.8.8.8) on lookup failure — without it `npm run ingest:ofac`
dies with a bare `ENOTFOUND` on an otherwise working connection.
