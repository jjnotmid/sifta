# Blockers

Anything that stopped a gate from passing cleanly, what was tried, and what is
needed to resolve it. Entries stay after resolution, marked as such.

---

## 0. OWNER ACTION — make the repo public before submitting

**Not a blocker for the build. It is pass/fail for the hackathon.**

`github.com/jjnotmid/sifta` is currently **private**, by request, and is being
pushed to after every passing gate.

Stage One of judging is pass/fail on a **public** repo with the MIT LICENSE
visible in the GitHub About section. The LICENSE is committed and GitHub
already detects it as MIT, so the only remaining step is the visibility flip:

    gh repo edit jjnotmid/sifta --visibility public --accept-visibility-change-consequences

Do this before **17 August 2026**, then confirm "MIT license" appears in the
right-hand About panel on the repo page.

---

## 1. Docker not installed on the build machine — WORKED AROUND

**Phase:** 0 (discovered), 1 (worked around)

**Symptom**

```
$ docker --version
zsh: command not found: docker
```

The build prompt specifies "run CockroachDB locally in Docker for Phases 1–5".
Docker Desktop is not present and installing it is not a reversible action I
should take on the owner's machine without asking.

**What was tried / what was done instead**

CockroachDB ships a self-contained binary that runs `start-single-node
--insecure` with no container runtime. `scripts/db-up.sh` downloads it to
`vendor/cockroach/` (gitignored) and starts a cluster on the same
`localhost:26257` the compose file would have used.

`docker-compose.yml` is committed and kept accurate, so a contributor with
Docker gets an identical cluster via `docker compose up -d`. Nothing in the
application or test code knows the difference — both paths are reached only
through `DATABASE_URL`.

**Needed from the owner**

Nothing to unblock the build. Optionally install Docker Desktop if you prefer
the compose path locally; the binary path is otherwise equivalent.

---

## 2. Node version is 26, not 20 — NO ACTION NEEDED

**Phase:** 0

The prompt and PRD specify Node.js 20. The build machine runs v26.0.0. No
dependency in the project requires a Node version below the Lambda runtime, and
the Lambda deployment bundle (Phase 7) still targets the `nodejs20.x` runtime
regardless of the local version. Recorded for transparency only.

---

## 3. OWNER ACTION — cloud credentials absent (Phase 6)

**Phase:** 6. **Not blocking.** Every gate passes; the affected tests skip
rather than fail, and every runtime path has a working fallback.

Per the build protocol ("if any credential is missing, log it, use the mock,
and keep going"), Phase 6 shipped all three real providers and the MCP client
without ever having exercised them against a live endpoint. What is verified
offline is the wiring, the type mapping, the dimension agreement, the error
classification, and the MCP read-only gate. What is *not* verified is that a
live Bedrock/Groq/CockroachDB Cloud endpoint answers as expected.

**What is needed, and what each unlocks**

| Variable | Unlocks | Without it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (+ Bedrock model access in `AWS_REGION`) | `PROVIDER=bedrock`, `EMBEDDING_PROVIDER=titan` | Mock provider; 2 tests skip |
| `GROQ_API_KEY` | `PROVIDER=groq` (throttling fallback) | Mock provider; 1 test skips |
| `CRDB_MCP_API_KEY` | Schema-exploration tools for the agent | `connect()` returns `unavailable`; agent runs with its five built-in tools |

**To verify once keys are present**

```
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm test -- providers
GROQ_API_KEY=... npm test -- providers
```

The integration tests un-skip automatically when the variables are set — there
is no flag to flip.

**Note on Bedrock model access.** An AWS account with valid credentials still
returns `AccessDeniedException` until model access is explicitly granted for
the model in the Bedrock console, per region. If `PROVIDER=bedrock` fails with
that error, the credentials are fine and the model grant is missing.

**Third-party embedding cost.** Re-embedding all **257,792** name variants
through Titan is a real spend and takes hours at Titan's one-input-per-call
rate (the provider is deliberately sequential to avoid tripping the
account-level limit). The mock embedder is a genuine character-trigram
embedder, not noise, so the eval measures something meaningful without it.
Switching `EMBEDDING_PROVIDER` requires a full re-ingest of variants — the
vectors in the database are only comparable to vectors from the same model.

---

## 4. No live MCP integration test — ACCEPTED

**Phase:** 6

`src/mcp/` is tested exhaustively without a network: the tokenizer, the
allow/deny gate, the fail-closed default, the namespace isolation, and the
credential-absent path. There is no test that connects to
`https://cockroachlabs.cloud/mcp`, because there is no key (see #3).

**Correction, 2 August.** The `X-Cockroach-MCP-Mode: read-only` request header
in `client.ts` was my invention and is not the documented mechanism. CockroachDB
Cloud enforces read-only through **Cloud RBAC on the service account whose API
key you use**: every tool invocation is permission-checked before it runs, and
requests are rejected when they exceed the account's scope.

So the correct setup is to grant the service account a read-only role scoped to
the cluster — documented in `ACCOUNTS.md` §5 — and the header is at best inert.
It is left in place because it costs nothing and would be honoured by a server
that happens to read it, but it should not be described as the guarantee.

The guarantee is two things, neither of which is that header: the RBAC role on
the far side, and the local gate in `readonly.ts` on ours, which refuses any
tool whose name implies a mutation regardless of what the server says about it.

---

## 5. ELIGIBILITY — mandatory tool requirements not yet met

**Not a build failure. This is the difference between being judged and being
disqualified.** Read from the official rules on 2 August.

The rules require **at least two** of these CockroachDB tools:

| Tool | Status |
|---|---|
| **Vector Indexing** | ✅ Used — inline, prefix-partitioned by jurisdiction, `EXPLAIN`-proven |
| **MCP Server** | ⚠️ Implemented in `src/mcp/`, but inert without `CRDB_MCP_API_KEY`. Does it count as "used" if it never connects? Assume not. |
| **ccloud CLI** | ❌ Not used |
| **Agent Skills Repo** | ❌ Not used |

…and **at least one AWS service**:

| Service | Status |
|---|---|
| Lambda / S3 / Bedrock | ❌ **None used.** Phase 7 is not built and no AWS account exists. |

### What this means

Counting strictly, the submission currently uses **one** CockroachDB tool and
**zero** AWS services. Both requirements are unmet.

Phase 7 was deferred as a scheduling choice — build the frontend first,
because it is what a judge sees. That reasoning was sound for *quality* and
wrong for *eligibility*: a beautiful console that uses no AWS service does not
get judged at all.

### Cheapest paths to compliant

- **Second CockroachDB tool:** get `CRDB_MCP_API_KEY` and let the agent make
  one real MCP call, or use the **ccloud CLI** to create the cluster and show
  it in the video. The CLI is the lower-effort of the two and is hard to argue
  with — you genuinely used it to provision the database.
- **AWS service:** Bedrock is the smallest real step — set `PROVIDER=bedrock`
  and let one investigation run through `ConverseCommand`. That is a used AWS
  service without needing Lambda or S3 at all. Lambda and S3 remain the
  stronger answer and are what Phase 7 delivers.

### Other submission requirements, for completeness

- Public open-source repo with README, dependencies, setup instructions — repo
  is **still private** (see #0); README exists.
- A URL to a **functional demo app** — deployed, but shows "No database" until
  a cloud cluster is attached.
- A video **under 3 minutes**, public on YouTube or Vimeo — not made.
- Deadline **18 August 2026, 5:00pm EDT**.
