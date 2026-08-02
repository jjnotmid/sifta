# Sifta

Sanctions screening that catches the spellings a list does not contain, and
remembers the decisions your analysts already made.

Built for the CockroachDB × AWS hackathon. MIT licensed.

---

## The problem, as one real case

A customer sends money as **`ABU M A BARNAWI`** — middle names written as
initials, which is what a bank transfer form actually produces.

The OFAC SDN list holds **`Abu Musab AL-BARNAWI`**, a real listed individual.

| System | Score | Verdict |
|---|---|---|
| Ordinary name matching (Jaro-Winkler) | 0.847 against its 0.88 threshold | **No match** |
| Sifta | distance 0.00 against 0.90 | **Match** |

You could loosen the first system until it catches him. At 0.84 it does — and
it flags **4,103** innocent customers instead of 2,643, so one more real hit
costs your analysts 1,460 more files to clear by hand.

Every figure above is measured, not asserted. `npm run eval:example`
regenerates it from the live database.

---

## Measured results

Both systems held to the same recall (the baseline's own ceiling), then judged
on how many innocent people they flagged. 200 known hits, 5,000 clean Nigerian
names, 19,181 real OFAC entities.

| | Jaro-Winkler baseline | Sifta |
|---|---|---|
| Recall | 81.5% | 88.0% |
| False positives (of 5,000) | 2,643 | 92 |
| Precision | 5.8% | 65.7% |

**96.5% fewer false positives at the same recall.**

The baseline never reaches 95% recall at any threshold — its ceiling is 81.5%,
because beyond that the spellings differ by more than character edits. Sifta
at its own operating point reaches 95.0% recall with 290 false positives.

Full method, threshold sweeps and stated limitations: [`eval/results.md`](eval/results.md).

---

## Setup

Node 20+. No Docker required — `db:up` downloads a CockroachDB binary if
Docker is absent.

### 1. Install

```sh
git clone https://github.com/jjnotmid/sifta.git
cd sifta
npm install
npm --prefix web install
```

### 2. Start the database and apply the schema

```sh
npm run db:up      # single-node CockroachDB on localhost:26257
npm run migrate    # idempotent; safe to re-run
```

### 3. Point the console at it

The console has no localhost fallback on purpose — a deployed instance
defaulting to localhost dials itself and fails with a misleading error. So set
it explicitly:

```sh
echo 'DATABASE_URL=postgresql://root@localhost:26257/sifta?sslmode=disable' > web/.env.local
```

### 4. Load the real watchlist

```sh
npm run ingest:ofac      # ~19,181 entities from the real OFAC SDN list (~28MB)
npm run ingest:variants  # generates + embeds ~257,000 name spellings — slow
```

`ingest:variants` is the long one. It embeds every generated spelling.

### 5. Raise a demo queue (optional, but do it for the demo)

```sh
npm run seed:demo
```

Screens real listed individuals and clean Nigerian names, runs the real agent
loop on each, records two decisions and re-screens those subjects so the
memory recall path has something to recall.

### 6. Check everything

```sh
npm run verify
```

Reports pass/fail/skip per step with the command that fixes each failure.

### 7. Run it

```sh
npm run web:dev    # → http://localhost:3000
```

| Route | What it is |
|---|---|
| `/` | The argument: one real case, the Field, the measured numbers |
| `/queue` | Alert queue. `j`/`k` move · `enter` open · `c` clear · `e` escalate |
| `/ledger` | Append-only decision ledger |
| `/alerts/<id>` | Investigation: subject, Field, agent trace, prior decisions |

---

## How it works

**1. Write down the spellings the list does not have.** A sanctions list gives
one official spelling and a few aliases. Sifta expands each name into the
forms people actually write — surname first, accents dropped, middle names as
initials, Chukwuemeka written as Emeka — driven by two human-editable data
files (`data/translit-rules.json`, `data/name-shortenings.json`).

**2. Match on similarity, not spelling.** Each spelling is embedded and stored
in a CockroachDB vector index, declared inline and prefixed by jurisdiction.
Character-by-character matching cannot cross a reordering and a respelling at
once.

**3. Remember what your analysts decided.** Before the model runs, Sifta
checks the ledger. If this subject was cleared before and the evidence has not
changed, the alert is disposed from that record — with the original analyst's
rationale attached, and no model call at all.

### The compliance boundary

The agent **proposes**; a human **disposes**. A proposed HIT always routes to
human review, and the agent has no path to writing a final HIT disposition.
That is enforced by the database, not by prompt: the application's `sifta_app`
role holds `SELECT, INSERT` on `decision` and nothing else, with `UPDATE` and
`DELETE` revoked. A bug in the application cannot rewrite a signed decision.

### Degradation

Provider selection is env-var only; no SDK is imported outside
`src/providers/`. If Bedrock is throttled, `PROVIDER=groq` is a config change.
If no credentials exist at all, everything runs on a deterministic
character-trigram embedder — a real lexical embedder, not noise, which is what
the eval above was measured with.

---

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Check the whole install, step by step |
| `npm test` | 106 tests (3 skipped without cloud credentials) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run db:up` / `db:down` | Local CockroachDB |
| `npm run migrate` | Apply `db/schema.sql`, idempotent |
| `npm run ingest:ofac` | Download and load the real OFAC SDN list |
| `npm run ingest:variants` | Generate and embed name spellings |
| `npm run seed:demo` | Raise a demo queue from real data |
| `npm run eval` | Full evaluation → `eval/results.md` (~8 min) |
| `npm run eval:snapshot` | Commit the headline numbers for the console |
| `npm run eval:example` | Find and commit the worked example |
| `npm run eval:field` | Commit a real screen for the hero Field |
| `npm run web:dev` | Console at http://localhost:3000 |

After any `npm run eval`, re-run `eval:snapshot` or the site quotes the
previous run.

---

## Deployment

See [`DEPLOY.md`](DEPLOY.md). Two things that are easy to get wrong:

- Vercel's **Root Directory** must be `web`, and **Framework Preset** must be
  **Next.js**. On `Other`, Vercel never invokes the Next builder, looks for a
  `public/` folder, and the build "succeeds" while serving nothing.
- With no `DATABASE_URL`, the site still deploys and every route returns 200.
  The marketing page renders in full from committed snapshots; the console
  pages say why they are empty rather than 500ing.

---

## Status

Built: schema and memory layer, OFAC ingestion, name variant generation, the
screening engine, the evaluation harness, the agent loop with memory recall,
real providers (Bedrock/Groq/local) and a read-only MCP client, and the
console and marketing site.

Not built yet: **Phase 7** — AWS Lambda handler, S3 snapshots, and
CockroachDB Cloud. Until that exists, a deployed console has no database
behind it. `npm run build:lambda` is referenced in `package.json` but the
script does not exist.

Known issues and things needed from the owner: [`BLOCKERS.md`](BLOCKERS.md).
Build history and judgement calls: [`PROGRESS.md`](PROGRESS.md).

---

## Disclosure

Prior fintech and compliance work informed the domain thinking. All code in
this repository was written during the submission period.
