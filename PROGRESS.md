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

---

## Phase 3 — Name variant generation

**Gate:** `npm run ingest:variants && npm test -- variants` → exit 0 ✅
(33 tests). **257,792** variants embedded across the individual entities.

**Built**

`src/ingest/variants.ts` — six rules, each a separately named and separately
tested function, per PRD §9:

1. `generateReorderings` — surname-first/surname-last permutations.
2. `generateDeaccented` — NFD normalisation with combining marks stripped.
3. `generateTransliterations` — driven by `data/translit-rules.json`
   (**20** seeded Yoruba/Igbo/Hausa alternations: `kw`↔`ku`, `ch`↔`c`,
   doubled-vowel collapse, and so on).
4. `generateShortenings` — driven by `data/name-shortenings.json`
   (**73** seeded traditional contractions: Chukwuemeka→Emeka,
   Oluwaseun→Seun, Oluwafemi→Femi …).
5. `generateInitialised` — middle names reduced to initials.
6. `generateDropped` — middle name removed entirely.

Both JSON files carry a `_README` key stating that they are seeds for the
project owner to expand, which is why they are structured as data rather than
inlined as constants.

**Judgement calls**

- **`MAX_VARIANTS_PER_NAME = 100`.** The rules compose combinatorially, and a
  seven-token Arabic name with four aliases can generate thousands of strings.
  Past ~100 the marginal variant is noise that costs an embedding, a row, and
  index recall. The cap is a named constant, not a magic number.
- **Generation is deterministic and de-duplicated per entity.** Same input,
  same variant set, in the same order — asserted, because the eval's
  reproducibility claim rests on it.
- **Only individuals get generated variants**, honouring PRD §9's scoping of
  entity resolution. The 9,840 companies and 1,524 vessels from Phase 2 remain
  screenable by their primary name and published aliases.
- **Single-token names do not crash the reorderer** — the degenerate case is
  tested, because OFAC contains mononyms.

---

## Phase 4 — Screening engine and the evaluation harness

**Gate:** `npm run eval` → exit 0, writes `eval/results.md` with a populated
table ✅

**Built**

- `src/screening/index.ts` — embeds a subject name, vector-searches candidates
  across partitions, returns ranked results with L2 distances.
  `DEFAULT_MATCH_THRESHOLD = 0.35`.
- `src/eval/jaro-winkler.ts` — the baseline. **Token-aware**, so name
  reordering costs it nothing ("Joshua Usifoh" vs "Usifoh Joshua" scores 1.0).
- `src/eval/corpus.ts` — both corpora, from fixed-seed PRNGs
  (`POSITIVE_SEED`, `NEGATIVE_SEED`) so two runs produce identical numbers.
- `data/nigerian-names.json` — **84 given names and 78 surnames** across
  Yoruba, Igbo and Hausa (PRD asked for 60/60).

**The headline number, and why it was rewritten**

The first version of this table reported each system at *its own* preferred
threshold. That is not a comparison. Any matcher can buy recall with false
positives, and reporting the baseline at the threshold where it flags
essentially every name inflated Sifta's advantage rather than measuring it.

The harness now holds **both systems to the same recall** — the baseline's own
ceiling — and compares the noise:

| | Jaro-Winkler baseline | Sifta |
|---|---|---|
| Recall (of 200 known hits) | 81.5% | 88.0% |
| False positives (of 5,000) | 2,643 | 92 |
| Precision | 5.8% | 65.7% |

**False-positive reduction at matched recall: 96.5%.**

The baseline **never reaches 95% recall at any threshold** — its ceiling is
81.5%, because the remaining spellings differ by more than character edits.
That is stated in `results.md` rather than worked around. Sifta at its own
operating point reaches 95.0% recall with 290 false positives.

**Judgement calls**

- **Every positive gets a variant transformation *plus* a character typo.**
  Without the typo the test string would appear verbatim in Sifta's own index
  and the eval would prove only that the pipeline is self-consistent. With it,
  the string is in neither system's index: Sifta must generalise from a near
  neighbour and the baseline must absorb the same noise.
- **The baseline is not a strawman.** It gets the full published alias list
  (43,728 names) and is token-aware. The only thing it lacks is generated
  variants — which is precisely the variable under test.
- **Negatives are cross-checked against the live watchlist and discarded on a
  genuine collision** (21 discarded this run), so a false positive is the
  matcher's noise rather than a real hit mislabelled.

---

## Phase 5 — Agent loop and memory recall

**Gate:** `npm test -- agent` → exit 0 ✅ (13 tests)

**Built**

`src/agent/` — a tool-use loop over the `LLMProvider` interface with the five
PRD §7 tools: `search_watchlist`, `recall_prior_decisions`,
`get_counterparty_history`, `compare_identifiers`, `propose_disposition`.

**The compliance boundary is structural, not prompted**

The agent **proposes**; a human **disposes**. A proposed HIT always routes to
human review, and the agent has no path to writing a final HIT disposition —
that is enforced by the loop's control flow and by the Phase 1 grant (the
`sifta_app` role holds `SELECT, INSERT` on `decision` and nothing else), not
by an instruction in the system prompt that a model could talk itself out of.
Tested directly: *"never writes a disposition to the ledger by itself"* and
*"routes a proposed HIT to human review rather than disposing it"*.

**Memory is consulted before the model, not by it**

`recall_prior_decisions` is exposed as a tool, but the short-circuit does not
depend on the model choosing to call it. If the subject key has a prior
CLEARED decision and the evidence is unchanged, the alert is disposed from the
ledger **with no LLM call at all** — the cheapest possible path, and the
product thesis. The recall survives name reordering because `subjectKey()`
sorts tokens (Phase 1).

**What blocks an auto-clear** — each its own test:

- a different date of birth on the subject,
- the subject now matching an unadjudicated entity,
- absent evidence, which is treated as *unknown* and never as exculpatory.

**Failure handling**

- A mid-loop LLM failure leaves the investigation `RECOVERABLE`, not corrupt.
- A failing tool is reported back to the model, which can adapt, rather than
  aborting the investigation.
- A model that ends its turn without proposing hands over to a human.
- `appendToolStep` writes via jsonb concatenation inside the `UPDATE`, so a
  crash mid-loop cannot lose or duplicate a trace step.

---

## Phase 6 — Real providers and MCP

**Gate:** `npm test` with `PROVIDER=mock` → exit 0 ✅
**106 passed, 3 skipped.** The 3 skipped are the real-provider integration
tests, skipped rather than failed because credentials are absent — see
`BLOCKERS.md` #3.

**Built**

- `src/providers/bedrock.ts` — `BedrockProvider` via **`ConverseCommand`**, and
  `TitanEmbeddingProvider` via Titan Text Embeddings V2. Bedrock types tool
  input as a non-exported recursive `DocumentType`; the aliases at the top of
  the file recover it from the shapes that *are* exported rather than reaching
  for `any` (the tech constraints forbid `any` outside tests).
- `src/providers/groq.ts` — `GroqProvider`, the throttling fallback.
- `src/providers/local.ts` — `LocalEmbeddingProvider`, Transformers.js
  `all-MiniLM-L6-v2` at 384 dims. `@xenova/transformers` is an **optional**
  dependency imported through a non-literal specifier, so the ONNX runtime is
  not a required download and a missing package produces an error naming the
  install command.
- `src/mcp/` — MCP client for the CockroachDB Cloud Managed MCP Server.

**Dimensions are one constant, as required**

Titan is 1024, MiniLM is 384. Both providers negotiate against
`EMBEDDING_DIMENSIONS` in `src/config.ts` — the same constant the migration
rewrites every `VECTOR(n)` literal from. `LocalEmbeddingProvider` throws at
**construction** if the schema was built for a different width, with the fix in
the message, rather than failing on an insert several hundred thousand rows
into an ingest.

**MCP read-only is enforced on our side**

The PRD asks for a read-only connection. The server is asked for one (a
`read-only` mode header), but is not *trusted* for it. `src/mcp/readonly.ts`
re-decides every tool locally, at both discovery and call time:

1. **DENY wins** — any tool whose name tokenises to a mutating verb is
   rejected *even if the server annotates it `readOnlyHint: true`*.
2. **Then ALLOW** — a tool must be annotated read-only or match the
   schema-exploration vocabulary. Unknown and unannotated tools are dropped.

An MCP server is a remote party whose tool list changes between deploys, and
the thing choosing tool names is a language model. A connection that is
read-only only because the far end said so is one misconfiguration away from
letting an LLM run DDL against a customer's cluster. The load-bearing test is
*"DENY beats a server that annotates a destructive tool as read-only"*.

MCP tools are exposed to the agent under a `crdb_` prefix so they can never
shadow one of the five PRD tools.

**Degradation, not failure**

Absent `CRDB_MCP_API_KEY`, `connect()` returns `{status: 'unavailable'}` with a
reason — it does not throw. The agent runs with its five built-in tools.
Provider selection is env-var-only, so "Bedrock access is still pending" or
"Bedrock is throttling us" is a one-line config change, not a refactor.

**One asymmetry worth naming:** Bedrock constructs fine without credentials
(the AWS SDK resolves them per-request), while Groq throws at construction on
a missing `GROQ_API_KEY`. That is deliberate and tested both ways — Groq has
one credential and no resolver chain, so an absent key is a startup-time
configuration error the operator should learn about immediately, not halfway
through an investigation.

**Deferred**

- `src/mcp/` has no live integration test; the read-only gate is tested
  exhaustively offline. See `BLOCKERS.md` #3.
- The Bedrock default model ID stays on the dated `us.anthropic.…` inference
  profile format, which is the correct identifier shape for the
  `ConverseCommand` path the PRD specifies. It is overridable via
  `BEDROCK_MODEL_ID`.

---

## Phase 7 — DEFERRED (owner decision)

Phase 7 (AWS Lambda + S3) was deliberately skipped to build the frontend
first, at the owner's request: Phase 7 produces nothing you can look at, and
the console is what the demo video is built around. Nothing in Phase 8 depends
on it — the console reads the local cluster directly. Phase 7 is still owed.

---

## Phase 8 — Frontend

**Gate:** `cd web && npm run build && npm run lint` → exit 0 ✅

**Built** — in the brief's own build order (§11).

1. **Tokens** (`web/app/globals.css`) — every colour, type step, spacing unit
   and motion constant from `SIFTA-DESIGN-BRIEF.md` §2–§4, and nothing else.
   Zero border radius is set globally on `*`, and `box-shadow` is forced to
   `none` on `*`, so the two hardest prohibitions cannot be violated by a
   later component even by accident.
2. **The Field** (`components/field.tsx`) — the signature element. Three
   states and only three: filled navy candidate, hollow cleared, amber match.
   Populates in 240ms, resolves left to right with a positional delay so the
   drain reads as a sweep, hard-edged mono tooltip on hover. Honours
   `prefers-reduced-motion` by painting the final state on the first frame.
3. **Alert queue** (`/queue`) — dense 40px rows, hairline rules, sticky
   header, no zebra striping, amber left-edge marker on live matches.
   Keyboard: `j`/`k`/`Enter`/`c`/`e`.
4. **Investigation view** (`/alerts/[id]`) — subject and Field left; agent
   trace as a timestamped mono log right; prior decisions beneath it with the
   two-Field memory comparison; disposition controls pinned bottom-right.
5. **Decision ledger** (`/ledger`) — mono throughout, austere, append-only.
6. **Marketing page** (`/`) — hero is the Field animating over a real
   candidate set, then the measured numbers, three steps without icons, the
   architecture, one call to action.

**Judgement calls**

- **`c` and `e` do not disposition immediately.** The brief asks for both as
  queue shortcuts; they open a rationale prompt instead of writing straight to
  the ledger. A disposition with no analyst rationale is worth nothing to the
  next screen of the same subject, and auto-filling one would be fabricating a
  compliance record.
- **The console never re-screens to draw the Field.** Candidates are recovered
  from `investigation.tool_trace`. Re-running the vector search on page load
  would show today's answer rather than the one the recorded decision was
  actually made on, and an audit trail that changes when you look at it is not
  an audit trail. This is why the agent's `search_watchlist` step now records
  the candidate set and not just its size.
- **No fixture data anywhere in `web/`.** Every figure is a live query or is
  parsed out of `eval/results.md`. If a source is missing the section is
  omitted rather than filled — the marketing page renders without a database,
  and renders *without the numbers section* if the eval has not been run.
- **`next lint` was replaced with the ESLint CLI.** It is deprecated in Next
  15 and prompts interactively on first run; a gate that waits for a keypress
  never exits 0.

**⚠ Screening defect found and fixed while seeding the queue**

`DEFAULT_MATCH_THRESHOLD` was **0.35**, with a comment claiming it was "the
operating point reported in eval/results.md". It was not. The sweep in that
file measures 0.35 at **3.5% recall — 193 of 200 known hits missed**. The
measured 95%-recall operating point is **0.90**, which is what the constant
now holds.

This is the worst class of bug this system can have. A screen that silently
drops 96% of true matches still looks healthy: the queue is quiet, the
false-positive count is zero, and every dashboard is green. It surfaced only
because seeding a demo queue produced 22 alerts and just one match, which
looked wrong. In AML a missed hit is the compliance failure; the whole
false-positive argument is downstream of catching the hit in the first place.

All 106 tests still pass with the corrected threshold.

**Files created**

```
web/{package.json,tsconfig.json,next.config.ts,eslint.config.mjs}
web/app/{globals.css,layout.tsx,page.tsx,actions.ts}
web/app/{queue,ledger}/page.tsx   web/app/alerts/[id]/page.tsx
web/components/{field,memory-comparison,nav,queue-table,disposition-panel}.tsx
web/lib/{db,queries,eval,constants}.ts
scripts/seed-demo.ts
```

**Deferred**

- The agent trace renders from the persisted `tool_trace`; it does not stream
  live. The brief asks for streaming, and the data model supports it — the
  trace is appended step by step — but the console currently reads it after
  the fact.
- Dark mode tokens are declared and the app respects
  `prefers-color-scheme`, but the palette has only been reviewed in light.
