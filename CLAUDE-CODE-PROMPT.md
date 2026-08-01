# Sifta — Claude Code Build Prompt

> **How to use this:** Put `SIFTA-PRD.md` and `SIFTA-DESIGN-BRIEF.md` in an empty folder alongside this file. Open Claude Code in that folder. Paste everything below the line into Claude Code as your first message.

---

You are the sole engineer building **Sifta**, an agentic AML investigation system, for the CockroachDB × AWS Hackathon. Deadline for submission is 17 August 2026.

Read `SIFTA-PRD.md` and `SIFTA-DESIGN-BRIEF.md` in full before writing any code. They are the specification. Where this prompt and those documents conflict, those documents win.

## Operating protocol — read this carefully

**Work autonomously from start to finish. Do not stop to ask for permission or confirmation.**

1. **Never ask me to approve a reversible action.** Create files, install packages, run tests, refactor, delete your own scratch work — just do it.
2. **Work in phases.** Each phase below has an **exit gate**: a command that must exit 0. You may not begin the next phase until the current phase's gate passes.
3. **Test-first.** For every module, write the test before the implementation. Run it. Watch it fail. Then implement until it passes.
4. **Self-repair loop.** When something fails: read the error, form a hypothesis, fix, re-run. Try up to **5 times**. If still failing after 5 attempts, append a full entry to `BLOCKERS.md` (what you tried, exact errors, what you need from me) and **move on to the next phase**. Never halt the whole build for one failure.
5. **Keep `PROGRESS.md` current.** After each phase, append: phase name, what was built, gate result, files created, anything deferred. This is how I follow along without interrupting you.
6. **Commit after every passing gate.** `git commit -m "phase N: <description>"`. Initialise the repo in Phase 0.
7. **Never invent data.** If you need sanctions data, download the real thing. If you need customer names, generate them from an explicit, documented list in the repo. Never hardcode fake results to make a test pass.
8. **Never stub a function and call the phase done.** A gate passes only when the real behaviour works.

## Environment strategy — this is why you won't get blocked

Build against local infrastructure first. Cloud comes last.

- **Database:** run CockroachDB locally in Docker for Phases 1–5. Only switch to CockroachDB Cloud in Phase 7. Local single-node with `--insecure` is fine.
- **LLM and embeddings:** implement a `MockProvider` that returns deterministic vectors and canned tool-call sequences. All tests run against the mock. Real providers get wired in Phase 6.
- **If any credential is missing**, log it in `BLOCKERS.md`, use the mock, and keep going. Never stop and wait for a key.

## Tech constraints

- TypeScript, Node 20, ESM. Strict mode on. No `any` outside of tests.
- `pg` for database access. No ORM.
- Vitest for tests.
- CockroachDB vector indexes must be declared **inline in `CREATE TABLE`**, never as standalone `CREATE VECTOR INDEX` (standalone blocks writes during backfill).
- **Never batch vector inserts.** Insert individually or in chunks of 10 or fewer.
- All LLM and embedding calls go behind the `LLMProvider` / `EmbeddingProvider` interfaces in `src/providers/types.ts`. No SDK import outside `src/providers/`.
- Frontend follows `SIFTA-DESIGN-BRIEF.md` exactly. Zero border-radius, no shadows, no gradients, no emoji, amber only ever means a match.

---

# PHASE 0 — Scaffold

Create the repo structure from PRD §7. Initialise git. Add MIT `LICENSE` (required for the hackathon; Stage One is pass/fail on this). Set up `package.json`, `tsconfig.json` (strict), `vitest.config.ts`, `.env.example`, `.gitignore`, `docker-compose.yml` for local CockroachDB.

Create `PROGRESS.md` and `BLOCKERS.md`.

**Gate:** `npm run typecheck && npm test` exits 0 (zero tests passing is acceptable here).

---

# PHASE 1 — Schema and database layer

Write `db/schema.sql` exactly as specified in PRD §7. Build `src/memory/` with typed functions for every table operation.

Write a migration runner that is idempotent — running it twice must not error.

**Tests required:**
- Schema applies cleanly to a fresh local cluster
- Migration is idempotent
- A `VECTOR(1024)` value round-trips correctly
- `embedding <-> $1` ordering returns nearest first
- `EXPLAIN` on the candidate query confirms the vector index is used and is partitioned by `jurisdiction`
- The `decision` table rejects UPDATE and DELETE (enforce append-only)

**Gate:** `docker compose up -d && npm run migrate && npm test -- memory` exits 0.

---

# PHASE 2 — Watchlist ingestion

Build `src/ingest/`.

Download the real OFAC SDN list from the Sanctions List Service at `https://ofac.treasury.gov/sanctions-list-service`. It is public, requires no authentication, and has no rate limits. Use the XML format (roughly 28MB, about 18,700 entities). Cache the download to `data/raw/` and gitignore it; commit a small fixture instead.

Parse into `watchlist_entity`: primary name, all aliases (AKA/FKA/DBA), DOB, nationality, program, source reference, full raw payload as JSONB.

**Tests required:**
- Parser handles the committed fixture and produces the expected entity count
- Aliases are extracted, not dropped
- Entities with missing DOB or nationality parse without error
- Re-ingesting the same file does not duplicate rows

**Gate:** `npm run ingest:ofac && npm test -- ingest` exits 0, and the database contains > 10,000 entities.

---

# PHASE 3 — Name variant generation

**This is the core intellectual contribution of the project. Do not treat it as boilerplate.**

Build `src/ingest/variants.ts`, generating realistic West African name variants from each watchlist name.

Implement these rules, each as a separately testable, individually named function:

1. **Reordering** — surname-first and surname-last permutations
2. **Diacritic stripping** — Unicode NFD normalisation, combining marks removed
3. **Transliteration variants** — driven by a data file `data/translit-rules.json` mapping common Yoruba/Igbo/Hausa spelling alternations (e.g. `kw`↔`ku`, `ch`↔`c`, doubled vowels collapsing)
4. **Traditional-name shortening** — driven by `data/name-shortenings.json` (e.g. Chukwuemeka → Emeka, Oluwaseun → Seun)
5. **Initialisation** — middle names reduced to initials
6. **Name-part dropping** — middle name removed entirely

Both JSON data files must be human-editable and documented, with a clear comment at the top saying they are to be expanded by the project owner. Seed them with your best effort — I will expand them myself.

Every generated variant is embedded and written to `name_variant` with its `variant_kind`.

**Tests required:**
- Each rule has its own test with at least 3 real Nigerian name examples
- Generation is deterministic — same input yields same variant set
- No duplicate variants for one entity
- A name with a single token doesn't crash the reorderer

**Gate:** `npm run ingest:variants && npm test -- variants` exits 0.

---

# PHASE 4 — Screening engine and the evaluation harness

Build `src/screening/` — embed a subject name, vector-search candidates within jurisdiction, return ranked results with distances.

Then build `src/eval/`, which is the most important deliverable in this phase.

**Baseline:** implement Jaro-Winkler string matching over the same watchlist.

**Test sets, both generated into `data/eval/`:**
- **Known positives:** 200 real SDN entries passed through the variant generator. These *must* be caught. Measures recall.
- **Known negatives:** 5,000 synthetic Nigerian names built combinatorially from `data/nigerian-names.json` (common Yoruba, Igbo, and Hausa given names and surnames — seed this file with at least 60 given names and 60 surnames across the three groups). None appear on any list. Measures false positives.

Run both test sets through both systems. Emit `eval/results.md` containing a comparison table: recall, false-positive count, and precision for baseline versus Sifta.

**This table is the headline claim of the entire submission. Print it to stdout at the end of the run.**

**Tests required:**
- Eval harness is reproducible — two runs give identical numbers
- Recall on known positives is reported and is above 0.95
- False positive counts are reported for both systems

**Gate:** `npm run eval` exits 0 and writes `eval/results.md` with a populated table.

---

# PHASE 5 — Agent loop and memory recall

Build `src/agent/`.

Tool-use loop against the `LLMProvider` interface. Implement these tools exactly as named in PRD §7:

`search_watchlist` · `recall_prior_decisions` · `get_counterparty_history` · `compare_identifiers` · `propose_disposition`

`recall_prior_decisions` is the differentiator — given a normalised subject key, return prior dispositions and analyst rationales. When a prior CLEARED decision exists and the evidence is unchanged, the agent auto-disposes.

Every step writes to `investigation.tool_trace`. Every disposition writes to the immutable `decision` ledger. The agent **proposes**; a human **disposes**. Never let the agent write a final HIT disposition without human confirmation — this is a compliance requirement, not a preference.

**Tests required (all against `MockProvider`):**
- Full loop: alert in → candidates → comparison → proposed disposition
- **The memory test:** screen a subject, record a CLEARED decision, screen the identical subject again, assert the second screen auto-disposes from memory and does not re-run full investigation
- Agent handles zero candidates without erroring
- Tool trace is persisted and reconstructable
- LLM failure mid-loop leaves the investigation in a recoverable state, not a corrupt one

**Gate:** `npm test -- agent` exits 0.

---

# PHASE 6 — Real providers and MCP

Implement `BedrockProvider` (using `ConverseCommand` and Titan Text Embeddings V2, 1024 dims) and `GroqProvider` as fallback, plus `LocalEmbeddingProvider` using Transformers.js with `all-MiniLM-L6-v2` (384 dims).

If falling back to 384-dim embeddings, the schema dimension must be configurable through one constant — not a manual edit in six places.

Implement `src/mcp/` — an MCP client connecting to the CockroachDB Cloud Managed MCP Server at `https://cockroachlabs.cloud/mcp` in **read-only mode**, exposing its schema-exploration tools to the agent.

If credentials are absent, log to `BLOCKERS.md` and continue with mocks. Do not stop.

**Gate:** `npm test` exits 0 with `PROVIDER=mock`. Real-provider integration tests are skipped, not failed, when credentials are absent.

---

# PHASE 7 — AWS deployment

Lambda handler in `src/lambda/handler.ts`, Node 20, exposed via Function URL. S3 for raw list snapshots and audit exports.

Connection pooling for Lambda: pool initialised **outside** the handler, `max: 1` per container. Document this in the README — it demonstrates real deployment experience.

Provide deployment as a single script. If AWS credentials are absent, generate the deployment artifacts and instructions, log to `BLOCKERS.md`, and continue.

**Gate:** `npm run build:lambda` produces a valid deployment bundle.

---

# PHASE 8 — Frontend

Next.js in `web/`, deployed to Vercel. Follow `SIFTA-DESIGN-BRIEF.md` precisely.

Build in this order:

1. **Tokens file** — the exact hex values and type scale from the brief. Everything derives from it.
2. **The Field component** — the signature element. A grid of modules; candidates populate, ruled-out cells go hollow, the match snaps to amber. 120ms/240ms timings, `cubic-bezier(0.2, 0, 0, 1)`. Respect `prefers-reduced-motion`.
3. **Alert queue** — dense table, 40px rows, hairline rules, keyboard navigation (`j`/`k`/`Enter`/`c`/`e`).
4. **Investigation view** — subject and Field left, streaming agent trace as mono log right, prior decisions beneath, disposition controls pinned.
5. **Decision ledger** — append-only, mono, filterable, exportable.
6. **Marketing page** — hero is the Field, animating. Then the eval numbers from `eval/results.md`. No pricing table, no testimonials, no logo wall.

**The two-Field memory comparison** — today's screen beside the same subject's prior screen with cells already hollowed — must exist as a component. It is the shot the demo video is built around.

**Hard prohibitions (design brief §6):** no border radius, no shadows, no gradients, no emoji, no glassmorphism, no "✨ Introducing" pill, no "AI-powered" copy anywhere, no fake testimonials, no Inter. Use Archivo and IBM Plex Mono.

**Gate:** `cd web && npm run build && npm run lint` exits 0.

---

# PHASE 9 — Documentation and submission package

Write `README.md` containing: what Sifta is in two sentences, the eval results table, architecture diagram, setup and run instructions from a clean clone, environment variables, the CockroachDB tools used and precisely what the agent does with each, the AWS services used, the Lambda pooling note, the degradation path when the LLM is throttled, and a disclosure that NepaWatch and prior fintech work informed the domain thinking while all code was newly written during the submission period.

Write `ARCHITECTURE.md` and generate `docs/architecture.png` (Mermaid rendered to PNG is fine).

Write `SUBMISSION.md` — the Devpost copy, pre-written: description, tool usage answers, and the video script from PRD §11 with the real eval numbers substituted in.

Verify the full setup path works from a clean clone in a fresh directory.

**Gate:** `npm run verify` — a script you write that runs typecheck, lint, all tests, and the eval end to end — exits 0.

---

# FINAL

When all gates pass, output a summary: what was built, the eval numbers, what's in `BLOCKERS.md`, and the exact list of things you need from me to finish. Then stop.

**Begin with Phase 0 now. Do not ask me anything before starting.**
