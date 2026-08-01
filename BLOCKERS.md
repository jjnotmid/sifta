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

One consequence is worth stating plainly rather than discovering on demo day:
the `X-Cockroach-MCP-Mode: read-only` request header is what the client *asks*
the server for, and it has not been confirmed against the live service. If the
server ignores or rejects that header, the local gate in `readonly.ts` is what
actually holds the read-only guarantee — which is why it was built to not
depend on the server's cooperation. When a key is available, confirm the
server's own read-only mechanism and align the header if it differs.
