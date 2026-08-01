# Blockers

Anything that stopped a gate from passing cleanly, what was tried, and what is
needed to resolve it. Entries stay after resolution, marked as such.

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
