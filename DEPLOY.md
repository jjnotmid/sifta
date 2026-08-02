# Deploying the console

## The 404 you saw

```
404: NOT_FOUND
Code: NOT_FOUND
```

Vercel built the **repository root**. There is no Next.js app there — the root
`package.json` is the screening engine and does not depend on `next` — so the
build produced nothing routable and every path 404s.

The app lives in `web/`.

## Fix: set the root directory

In the Vercel project → **Settings → Build and Deployment → Root Directory**,
set:

```
web
```

Leave "Include files outside the root directory" **off**. Nothing in `web/`
reaches outside it any more: the eval numbers are committed to
`web/data/eval-headline.json` by `npm run eval:snapshot` precisely so the
deployed app never has to read `../eval/results.md`.

Framework preset detects as Next.js. No build-command override is needed.

## What you get without a database

The console is a **read view over a live CockroachDB cluster**. It holds no
data of its own. With no `DATABASE_URL` set, the deployment still works and
every route returns 200:

| Route | Without a database |
|---|---|
| `/` | Renders in full. The measured eval numbers are committed, so the headline stands. The hero Field is omitted rather than faked. |
| `/queue` | Renders the shell and a panel naming the reason. |
| `/ledger` | Same. |
| `/alerts/[id]` | Same. |

That is deliberate. A marketing page with an invented Field, or a queue with
fixture alerts, would be exactly the thing the design brief bans — and it
would misrepresent a compliance tool. An empty state that says why is honest;
a populated one that is fabricated is not.

**So: expect a working marketing page and three "No database" panels until a
cluster is attached.**

## Attaching a cluster

The local cluster is not reachable from Vercel — `localhost:26257` on a
serverless function is the function itself. You need CockroachDB Cloud, which
is Phase 7 of the build and is not done yet.

Once it exists:

1. Create the cluster and database, and run the migration and ingest against
   it:
   ```sh
   DATABASE_URL='postgresql://…@…:26257/sifta?sslmode=verify-full' npm run migrate
   DATABASE_URL='…' npm run ingest:ofac
   DATABASE_URL='…' npm run ingest:variants
   DATABASE_URL='…' npm run seed:demo      # optional: raises a demo queue
   ```
2. Add `DATABASE_URL` to the Vercel project's environment variables.
3. Redeploy.

Use the least-privilege `sifta_app` login, never `root`. `db/schema.sql`
creates it and revokes `UPDATE`/`DELETE` on `decision`, which is what makes
the ledger append-only by grant rather than by convention — that guarantee is
worth keeping in the deployed environment, where it matters most.

**Serverless connection pooling.** `web/lib/db.ts` keeps one module-scoped
pool with `max: 4`, reused across invocations in the same container. If you
see connection exhaustion under load, drop it to `max: 1` — a serverless
container serves one request at a time, so a larger pool buys nothing and
multiplies the connection count by the number of warm containers.

## Running it locally instead

Nothing above is needed to see the console. Locally it has a real cluster and
real data:

```sh
npm run db:up
npm run migrate
npm run ingest:ofac
npm run ingest:variants
npm run seed:demo
npm --prefix web run dev     # http://localhost:3000
```

## Keeping the numbers current

`web/data/eval-headline.json` is generated, not hand-written. After any
`npm run eval`, regenerate it or the marketing page will quote the previous
run:

```sh
npm run eval
npm run eval:snapshot
```
