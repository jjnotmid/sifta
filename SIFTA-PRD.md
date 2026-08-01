# Sifta — PRD

**Agentic AML investigation memory for African financial institutions**

| | |
|---|---|
| **Author** | Usifoh Joshua |
| **Version** | 1.0 |
| **Date** | 1 August 2026 |
| **Target** | CockroachDB × AWS Hackathon — Build with Agentic Memory |
| **Submission deadline** | 18 August 2026, 5:00pm EDT (submit 17 August) |
| **Status** | Ready for build |

> **Note on the name:** "Sifta" (from *sift*) is a placeholder. Alternates: **Kinship** (plays on name-matching), **Nomos**, **Tally**. Pick one and find/replace before building.

---

## 1. Executive Summary

We're building **Sifta**, an agentic AML (anti-money-laundering) investigation system for compliance analysts at African fintechs and microfinance banks, to solve the problem that sanctions and PEP screening tools built for Western name conventions generate overwhelming false-positive rates on African names — and then forget every decision an analyst ever makes, forcing the same entity to be re-investigated forever.

Sifta uses CockroachDB as a production-grade, four-layer agent memory: a distributed vector index over name variants and transaction narrations, an immutable transactional decision ledger, live investigation state, and a counterparty graph. The result is an agent whose accuracy compounds with every analyst decision instead of resetting to zero.

**Why this wins the hackathon:** memory is not decorative here — it is the entire product thesis. An AML agent without persistent, consistent, always-available memory is not a degraded AML agent; it is useless and non-compliant.

---

## 2. Problem Statement

### Who has this problem?

Compliance analysts and compliance officers at Nigerian and pan-African fintechs, payment service providers (PSPs), microfinance banks (MFBs), and bureaux de change — institutions regulated by the CBN and reporting to the NFIU, but without the compliance headcount of a tier-1 bank.

### What is the problem?

Every outbound transaction must be screened against sanctions and PEP lists. Two failures compound:

**Failure 1 — African names break Western fuzzy matching.**

Screening engines were tuned on Anglo-European name conventions. African names defeat them in ways that are structural, not incidental:

- **Inconsistent ordering.** "Usifoh Joshua" and "Joshua Usifoh" are the same person. Standard matchers treat surname position as stable.
- **Transliteration variance.** Yoruba, Igbo, and Hausa names have multiple valid Latin spellings. Ìbùkún / Ibukun / Ibukunoluwa. Chukwuemeka / Chukuemeka / Emeka.
- **Diacritic loss.** Tonal marks are stripped inconsistently across systems.
- **Name-part inflation.** Many individuals carry an English given name, a traditional name, and a family name, and use different subsets in different contexts.
- **High-frequency surnames.** Common surnames across large populations produce enormous candidate sets.

Result: false-positive rates that force analysts to manually clear the overwhelming majority of alerts. Every hour spent clearing a false positive is an hour not spent on a real one.

**Failure 2 — the decision is thrown away.**

An analyst clears "Joshua Usifoh — not the sanctioned individual, DOB and nationality mismatch." Tomorrow the same customer transacts. The system raises the identical alert. Nothing was learned. Institutional knowledge lives in analysts' heads and walks out the door when they resign.

### Why is it painful?

**For the analyst:** repetitive, morale-destroying work. Alert fatigue causes real hits to be waved through — the exact failure mode regulators sanction institutions for.

**For the institution:** compliance headcount scales linearly with transaction volume. For a growing fintech this is a tax on growth. And regulatory penalties for a missed hit are existential.

**For the regulator:** noisy screening produces low-quality Suspicious Transaction Reports.

### Evidence

> **Build note:** This section is where hackathon submissions get weak. Strengthen it before submitting. You have direct access to the Nigerian fintech ecosystem — get two or three quotes from compliance people you know and put them here with attribution and date. Real quotes from real practitioners will separate this from every other entry. Placeholder structure below.

- **Practitioner interviews:** [2–3 quotes from compliance officers, name/role/date]
- **Public data:** OFAC SDN, UN Consolidated, EU, and UK OFSI lists are all free and public — quantify candidate-set explosion by running a real Nigerian name file against them and reporting the measured false-positive count. **This measured number is your single most persuasive artifact. Generate it early and put it in the README, the video, and the Devpost description.**
- **Regulatory context:** CBN AML/CFT regulations and NFIU reporting obligations

---

## 3. Target Users & Personas

### Primary persona: "Compliance Analyst Amaka"

- **Role:** AML analyst, 3-person compliance team at a Lagos fintech (~500k users)
- **Tech savviness:** Medium. Lives in spreadsheets and a vendor screening console.
- **Goals:** Clear the alert queue before end of day. Never miss a real hit.
- **Pain points:** Alert queue never empties. Same names recur endlessly. No memory of what she decided last week. Handover to a colleague loses all context.
- **Jobs to be done:** *When an alert fires, I want to know whether we have seen this entity before and what we decided, so I can dispose of it in seconds instead of restarting the investigation.*

### Secondary persona: "Head of Compliance Tunde"

- **Role:** Compliance officer, personally liable under CBN regulations
- **Goals:** Defensible audit trail. Prove every decision to a regulator on demand.
- **Pain points:** Cannot evidence *why* a decision was made months later.
- **Buying trigger:** He signs the cheque. Sell to Amaka's pain, close on Tunde's liability.

---

## 4. Strategic Context

### Why now

1. Agent tooling has matured enough for an LLM to conduct structured investigation with tool use rather than just classify.
2. Vector search and transactional consistency now live in one database. Previously you needed Postgres + a separate vector store, with no consistency guarantee between them — unacceptable when the vector store informs a regulated decision.
3. African fintech transaction volume is growing faster than compliance headcount can.

### Competitive landscape

| Category | Players | Weakness Sifta exploits |
|---|---|---|
| Global screening vendors | World-Check, ComplyAdvantage, LexisNexis | Priced for tier-1 banks; matching tuned on Western names; no learning loop |
| African KYC/identity | Smile ID, Dojah, Youverify, Prembly | Strong on identity verification, thinner on ongoing AML screening + case memory |
| In-house | Spreadsheets + raw list downloads | Free, unscalable, undefendable to a regulator |

**Positioning:** Sifta is not a replacement for a screening vendor. It is the **memory and triage layer that sits in front of one**, cutting the queue an analyst actually has to touch. That framing matters commercially — it is a low-risk, additive purchase, not a rip-and-replace.

---

## 5. Business Model

> Included deliberately. "Real-World Impact" is a scored criterion, and a credible revenue model is the difference between a demo and a product.

### Revenue model: per-screening API + tiered platform fee

**Why per-screening:** African fintechs already buy KYC/verification on a per-check basis. The billing motion, procurement path, and mental model exist. You are not creating a new budget line, you are competing for an existing one.

**Structure:**

| Tier | Who | Model |
|---|---|---|
| **Starter** | MFBs, small PSPs | Per-screen fee, no minimum, self-serve API key |
| **Growth** | Scaling fintechs | Monthly platform fee + reduced per-screen rate, includes case management and audit export |
| **Enterprise** | Banks, large PSPs | Annual contract, VPC/on-prem deployment, custom list ingestion, SLA |

**Pricing anchor:** benchmark against what Nigerian institutions currently pay per verification check with existing providers, and price the triage layer below that — you are selling a reduction in analyst hours, not a replacement check. **Validate actual current rates with two buyers before setting a number. Do not guess.**

### The value argument (how you actually sell it)

Sell reduction in analyst-hours, not software.

```
Alerts/month × % false positives × minutes per manual clear
  = analyst hours consumed

Sifta cuts the queue by auto-disposing alerts matching prior decisions
  → hours saved × fully-loaded analyst cost = customer's annual saving
  → price at a fraction of that saving
```

Run this arithmetic live in a sales call with the buyer's own numbers. This is exactly the motion you already used to renegotiate a deal 272% — anchor on quantified value, not feature lists.

### The long-term moat: the consortium data layer

Single-institution memory is a good product. **Cross-institution memory is a defensible business.**

Once multiple institutions run Sifta, the entity-resolution graph — which name variants resolve to which real entities, which have been cleared and on what evidence — becomes an asset no single customer could build. Every new customer improves accuracy for all of them. Classic data network effect, and the model behind shared fraud-intelligence utilities in other markets.

**Critical constraints, stated honestly:** this requires careful data-sharing agreements, privacy review under NDPR, and almost certainly regulator engagement. Share *derived resolution signals*, never raw customer PII. This is a year-two ambition, not a hackathon feature — but naming it in the submission shows judges you understand where the product goes.

### Go-to-market

**Wedge:** free tier — an institution uploads a name file and gets back a measured false-positive reduction report. Zero-friction, proves value with the buyer's own data, generates the case study.

**Land:** 3–5 design partners among Lagos fintechs and MFBs. This is where your BD background is worth more than the code.

**Expand:** case management → audit export → transaction monitoring → consortium.

### Honest risks in this business

- **Long sales cycles.** Regulated buyers move slowly and demand security review. Mitigate by starting with fintechs and MFBs, not banks.
- **Trust barrier.** Nobody hands compliance data to an unknown vendor. Mitigate with self-hosted/VPC deployment as an option from day one, and by positioning as an additive layer.
- **"Can we just build this?"** Larger institutions will ask. The consortium data is the answer — they cannot build a cross-institution graph alone.
- **Regulatory posture on AI decisioning.** Sifta must *assist* a human decision, never make an unreviewed final one. Design for human-in-the-loop from the start; it is both the right call and the compliant one.

---

## 6. Solution Overview

### Core loop

```
Transaction / customer screened
        ↓
Candidate generation      → vector search over name-variant embeddings,
                            partitioned by jurisdiction
        ↓
Memory recall             → have we adjudicated this entity before?
                            retrieve prior decision + analyst rationale
        ↓
Agent investigation       → LLM with tools: compare DOB, nationality,
                            counterparty history, prior decisions
        ↓
Disposition               → AUTO-CLEAR (matches prior decision, evidence
                            unchanged) | ESCALATE (human review) | HIT
        ↓
Analyst decides           → decision written to immutable ledger +
                            embedded into memory
        ↓
                          [ loop closes — next time, it remembers ]
```

### The four memory layers (this is the heart of the submission)

| Layer | Contents | CockroachDB feature |
|---|---|---|
| **Semantic** | Name-variant + narration embeddings | Distributed vector index, prefix-partitioned by jurisdiction |
| **Episodic** | Every alert raised and its outcome | Time-ordered relational tables |
| **Procedural** | Live investigation state machine | Transactional row state, ACID |
| **Ledger** | Immutable, append-only decision record | Transactions + audit logging |

**Say this explicitly in the video and README:** all four layers live in one database with one consistency guarantee. A decision and the embedding that justified it are written in the same transaction. There is no window where the vector store and the ledger disagree. That is not achievable with Postgres + an external vector store, and it is the specific technical claim this project exists to demonstrate.

---

## 7. Technical Specification

### Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, Node.js 20 |
| Database | CockroachDB Cloud Basic ($400 trial credits + $15/mo recurring free credit; no card required) |
| DB driver | `pg` (node-postgres) |
| Compute | AWS Lambda, Node 20, Function URL |
| Storage | Amazon S3 — raw list snapshots and audit exports |
| LLM | Amazon Bedrock (`ConverseCommand`) behind a provider interface |
| Embeddings | Bedrock Titan Text Embeddings V2 (1024 dims) **or** local Transformers.js `all-MiniLM-L6-v2` (384 dims) |
| 2nd CockroachDB tool | Cloud Managed MCP Server, read-only — `https://cockroachlabs.cloud/mcp` |
| 3rd CockroachDB tool | Agent Skills Repo (bonus; 2 hours of work) |
| Frontend | Next.js on Vercel |
| Data | OFAC SDN, UN Consolidated, EU, UK OFSI — all free and public |

**Cost target: $0.** Select **AWS Free Plan** at signup — credits act as a hard cap rather than rolling into billing. Set an AWS Budget alert at $5.

### Schema

Verified against current CockroachDB syntax. Vector support is pgvector-compatible.

```sql
-- Watchlist entities (sanctions/PEP targets)
CREATE TABLE watchlist_entity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list     STRING NOT NULL,          -- 'OFAC_SDN' | 'UN' | 'EU' | 'UK_OFSI'
  source_ref      STRING NOT NULL,
  jurisdiction    STRING NOT NULL,
  primary_name    STRING NOT NULL,
  dob             DATE,
  nationality     STRING,
  raw_payload     JSONB,
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_list, source_ref)
);

-- Name variants, embedded. The semantic memory layer.
-- Vector index declared INLINE and partitioned by jurisdiction.
CREATE TABLE name_variant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID NOT NULL REFERENCES watchlist_entity(id),
  jurisdiction    STRING NOT NULL,
  variant_text    STRING NOT NULL,
  variant_kind    STRING NOT NULL,          -- 'primary'|'aka'|'translit'|'reordered'
  embedding       VECTOR(1024),
  VECTOR INDEX name_vec_idx (jurisdiction, embedding vector_l2_ops),
  INDEX idx_variant_entity (entity_id)
);

-- Alerts raised. Episodic memory.
CREATE TABLE alert (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_name    STRING NOT NULL,
  subject_dob     DATE,
  subject_nat     STRING,
  jurisdiction    STRING NOT NULL,
  txn_ref         STRING,
  txn_narration   STRING,
  narration_vec   VECTOR(1024),
  matched_entity  UUID REFERENCES watchlist_entity(id),
  match_distance  DECIMAL(10,6),
  status          STRING NOT NULL DEFAULT 'OPEN',  -- OPEN|INVESTIGATING|CLEARED|HIT|ESCALATED
  raised_at       TIMESTAMPTZ DEFAULT now(),
  VECTOR INDEX alert_narration_idx (jurisdiction, narration_vec vector_l2_ops),
  INDEX idx_alert_status (status, raised_at DESC)
);

-- Immutable decision ledger. Never UPDATE. Never DELETE.
CREATE TABLE decision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alert(id),
  subject_key     STRING NOT NULL,          -- normalised subject identity
  entity_id       UUID REFERENCES watchlist_entity(id),
  disposition     STRING NOT NULL,          -- CLEARED|HIT|ESCALATED
  rationale       STRING NOT NULL,          -- analyst's words: the durable asset
  rationale_vec   VECTOR(1024),
  decided_by      STRING NOT NULL,
  agent_assisted  BOOL DEFAULT true,
  agent_reasoning JSONB,
  decided_at      TIMESTAMPTZ DEFAULT now(),
  VECTOR INDEX decision_vec_idx (subject_key, rationale_vec vector_l2_ops),
  INDEX idx_decision_subject (subject_key, decided_at DESC)
);

-- Live agent investigation state. Procedural memory.
CREATE TABLE investigation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alert(id),
  state           STRING NOT NULL,          -- PENDING|GATHERING|REASONING|AWAITING_HUMAN|DONE
  step_count      INT DEFAULT 0,
  tool_trace      JSONB,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### Two schema rules that will save a day each

1. **Declare vector indexes inline in `CREATE TABLE`.** A standalone `CREATE VECTOR INDEX` on a populated table blocks INSERT/UPDATE/DELETE on that column until backfill finishes. It will look like your app has hung.
2. **Do not batch vector inserts.** CockroachDB's docs explicitly warn that large batch vector inserts degrade performance. Insert individually or in small chunks.

### Query pattern

```sql
-- Candidate generation, partitioned by jurisdiction
SELECT nv.entity_id, nv.variant_text, we.primary_name, we.dob, we.nationality,
       nv.embedding <-> $2 AS distance
FROM name_variant nv
JOIN watchlist_entity we ON we.id = nv.entity_id
WHERE nv.jurisdiction = $1
ORDER BY nv.embedding <-> $2
LIMIT 20;
```

The `jurisdiction` prefix means a Nigerian screen searches only the Nigerian partition, not the global index. **Demonstrate this on camera with EXPLAIN.** It proves you understood the *distributed* part of distributed vector indexing. Most entrants will use a flat index.

### Agent tools

Expose these to the model via Bedrock `ConverseCommand` tool config:

| Tool | Purpose |
|---|---|
| `search_watchlist` | Vector candidate generation over name variants |
| `recall_prior_decisions` | **The differentiator.** Has this subject been adjudicated before? Returns prior disposition + rationale |
| `get_counterparty_history` | Transaction pattern for the subject |
| `compare_identifiers` | Structured DOB / nationality / ID comparison |
| `propose_disposition` | Agent's recommendation + reasoning — never final, always human-reviewed |
| MCP tools | Read-only schema exploration via CockroachDB Cloud MCP Server |

### Provider abstraction — build this first

```typescript
// src/providers/types.ts
export interface LLMProvider {
  generate(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse>;
}
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

Implement `BedrockProvider` first. Keep `GroqProvider` and `LocalEmbeddingProvider` (Transformers.js) as swappable fallbacks. If Bedrock model access is delayed, you change one env var — not the codebase. If you fall back to local embeddings, change `VECTOR(1024)` to `VECTOR(384)`. Nothing else changes.

### Repository structure

```
sifta/
├── LICENSE                    # MIT — REQUIRED, visible in GitHub About
├── README.md                  # judges read this first
├── ARCHITECTURE.md
├── docs/architecture.png
├── db/
│   ├── schema.sql
│   └── seed/
├── src/
│   ├── providers/             # LLM + embedding abstraction
│   ├── memory/                # CockroachDB access layer
│   ├── agent/                 # Converse loop, tool definitions
│   ├── mcp/                   # CockroachDB MCP client (read-only)
│   ├── ingest/                # OFAC/UN/EU/OFSI parsers, variant generation
│   └── lambda/handler.ts
├── web/                       # Next.js analyst console
└── .env.example
```

### Production-readiness details judges will look for

- **Lambda connection pooling.** Each warm container holds its own pool. Set `max: 1` and initialise outside the handler. Document this in the README — it proves you have deployed something real.
- **Least-privilege service account** for the DB. Read-only MCP mode. No root connection string anywhere.
- **Immutable ledger** — decisions are append-only. Enforce it and say so.
- **Degradation path.** What happens when the LLM is throttled? Answer: alerts queue, no auto-disposition, human queue continues. Write this down.
- **Human-in-the-loop by design.** The agent proposes; a human disposes. State this as a deliberate compliance decision, not a limitation.

---

## 8. Success Metrics

### Hackathon metrics (what you're actually optimising for)

| Judging criterion | How Sifta scores | Your evidence |
|---|---|---|
| Agentic Memory Design | Four memory layers, one consistency domain | Schema + live demo of decision recall |
| Technological Implementation | Vector + transactional in one DB; MCP read-only; prefix-partitioned index | `EXPLAIN` on camera |
| Real-World Impact | Measured false-positive reduction + business model | Your measured number |
| Product Readiness | RBAC, audit trail, immutable ledger, degradation path | README section |
| Creativity & Originality | African name entity resolution — nobody else is doing this | Demo with real name variants |

### Product metrics (for the README and any future pitch)

- **Primary:** % reduction in alerts requiring manual analyst review
- **Secondary:** auto-disposition precision (must approach 100% — a false auto-clear is a compliance failure); median time-to-disposition; recall rate on known-hit test set

---

## 9. Out of Scope

Deliberately excluded. Say so in the README — scope discipline reads as maturity.

- **Transaction monitoring / typology detection.** Different product. Screening only.
- **Automated STR filing.** Regulatory exposure, human judgement required.
- **Consortium cross-institution sharing.** Named as roadmap; not built.
- **Full case-management UI.** Minimal analyst console only.
- **Non-name entity resolution** (addresses, vessels, corporates). Individuals only.
- **Live core-banking integration.** API + file upload only.

---

## 10. Build Plan

| Days | Work |
|---|---|
| **Aug 1–2** | AWS account (**Free Plan**), Bedrock model access request, CockroachDB Cloud cluster, budget alert. Blocking items only. |
| **Aug 3–5** | Schema + list ingestion + variant generation + embeddings. Prove vector search from a local script. No agent, no UI. |
| **Aug 6–8** | Agent loop, tool definitions, MCP client, prior-decision recall. |
| **Aug 9–10** | Lambda deploy, S3 wiring, Next.js console. |
| **Aug 11–12** | Measure the false-positive reduction number. Write README + ARCHITECTURE + architecture diagram. |
| **Aug 13–15** | Video. Two full days minimum. |
| **Aug 16–17** | Buffer, then submit. **Do not touch the 18th.** |

---

## 11. Video Script (<3 minutes)

Weighted equally with the code in practice. Most entrants fumble it.

| Time | Content |
|---|---|
| 0:00–0:20 | The problem, concretely. Show a real African name producing a large false-positive candidate set in a conventional matcher. State your measured number. |
| 0:20–0:50 | Screen a transaction in Sifta. Agent generates candidates via vector search. Show the CockroachDB query running. |
| 0:50–1:30 | **The money shot.** Analyst clears the alert with a rationale. Screen the *same subject* again. Agent recalls the prior decision and auto-disposes. Show the ledger row. *This is your submission in fifteen seconds.* |
| 1:30–2:10 | Architecture diagram. Name the tools: distributed vector indexing, MCP Server read-only, Agent Skills; Bedrock, Lambda, S3. Show `EXPLAIN` proving jurisdiction partitioning. |
| 2:10–2:45 | Production readiness: immutable ledger, RBAC, audit trail, human-in-the-loop. |
| 2:45–3:00 | Impact + business model in two sentences. |

**Rules compliance:** must show the project functioning, must show the CockroachDB memory layer at work, must be public on YouTube or Vimeo, no copyrighted music.

---

## 12. Submission Checklist

- [ ] Public GitHub repo with **MIT LICENSE file visible in the About section** (Stage One is pass/fail — this disqualifies people)
- [ ] README: setup, run instructions, dependencies, seed data
- [ ] Functional demo app URL, free and unrestricted through 15 September
- [ ] Video <3 min, public on YouTube/Vimeo
- [ ] CockroachDB tools named and explained: **vector indexing + MCP Server** (+ Agent Skills)
- [ ] AWS services named: Bedrock, Lambda, S3
- [ ] Architecture diagram (optional but do it)
- [ ] Tool feedback (optional but do it — sponsors read it)
- [ ] All materials in English
- [ ] **Disclose** that NepaWatch and prior fintech work informed the domain thinking; all code newly written during the submission period
- [ ] Submitted by **17 August**

---

## 13. Open Questions

1. Which jurisdictions to seed beyond Nigeria? (Recommend: Nigeria, Ghana, Kenya — enough to demo partitioning.)
2. Auto-clear threshold — what distance + evidence-match confidence justifies bypassing human review? (Recommend: conservative. A false auto-clear is worse than a false escalation.)
3. Bedrock or Groq? (Resolved by the provider abstraction — decide on Aug 3 based on access.)
4. Verify current per-check pricing from at least two Nigerian buyers before quoting any number.
