# Accounts and credentials

Everything Sifta can use, what each one unlocks, and what happens without it.

**Read this first:** the project runs today with none of these. Providers are
selected by env var and default to a deterministic local embedder, and the
console degrades to an explained empty state rather than failing. So do these
in the order below, and stop when you have what you need — not all of it is
worth the setup cost before a deadline.

### Accounts that are not credentials

These have no env var and nothing in the code touches them — but the
submission does not exist without the first one.

| Account | Cost | Why |
|---|---|---|
| **Devpost** | Free, no card | Where the hackathon is actually submitted. Nothing is judged without it. |
| **YouTube or Vimeo** | Free | The demo video must be *public* on one of them — a rules requirement, not a preference. |
| GitHub | Have it | The repo must be **public** before judging — see `BLOCKERS.md` #0 |
| Vercel | Have it | Hosts the console |

### Credentials the code reads

| Service | Env var | Unlocks | Without it |
|---|---|---|---|
| CockroachDB Cloud | `DATABASE_URL` | A deployed console with real data | Deployed console shows "No database"; local dev unaffected |
| AWS — Bedrock | `AWS_*`, `BEDROCK_*` | Real LLM + Titan embeddings | Mock provider; 2 tests skip |
| AWS — S3 | `S3_BUCKET` | List snapshots, audit exports | Phase 7 feature, not built yet |
| AWS — Lambda | — | Function URL deployment | Phase 7, not built yet |
| Groq | `GROQ_API_KEY` | Fallback when Bedrock throttles | Mock provider; 1 test skips |
| CockroachDB MCP | `CRDB_MCP_API_KEY` | Schema-exploration tools for the agent | Agent runs with its five built-in tools |

**Priority for the 17 August deadline:** CockroachDB Cloud first — it is the
only one that changes what a judge sees. Bedrock second, because "Amazon
Bedrock" is a named judging criterion. Groq and MCP are nice to have.

---

## 1. CockroachDB Cloud — do this one first

This is what makes your deployed site show real alerts instead of an empty
state.

### Create the cluster

1. Sign up at [cockroachlabs.cloud](https://cockroachlabs.cloud).
2. Create a cluster. Choose **Basic** and **Start for free** — new
   organisations get **$400 in trial credits**, and Basic scales to zero, so a
   demo workload costs approximately nothing. No card is required to start.
3. Pick a cloud and region near you. AWS is the sensible choice for this
   hackathon.

### Create the SQL user

A **Create SQL user** dialog appears once the cluster is up. Enter a username,
click **Generate & save password**, and copy the password somewhere safe — it
is shown once.

> New SQL users are created with admin privileges. For the demo that is fine.
> If you want the append-only ledger guarantee enforced in the cloud the way it
> is locally, run `db/schema.sql`'s grant block afterwards so the app connects
> as `sifta_app` rather than as an admin. That is the difference between "the
> ledger is append-only" and "the ledger is append-only and the database will
> refuse to let you prove otherwise".

### Get the connection string

In the cluster's **Connect** dialog, choose the **General connection string**.
It is pre-populated with your username, password and host. It looks like:

```
postgresql://<user>:<password>@<host>:26257/<db>?sslmode=verify-full
```

Some regions also require a CA certificate — the Connect dialog tells you if
so and gives you the download command.

### Load the data into it

Point the same scripts you ran locally at the cloud cluster. This takes a
while; `ingest:variants` embeds ~257,000 spellings.

```sh
export DATABASE_URL='postgresql://…?sslmode=verify-full'
npm run migrate
npm run ingest:ofac
npm run ingest:variants
npm run seed:demo
npm run eval:field        # refresh the committed hero snapshot from cloud data
```

### Give it to Vercel

Vercel project → **Settings → Environment Variables** → add `DATABASE_URL`
for the **Production** environment → **Redeploy**.

`/queue` and `/ledger` will now show real alerts.

---

## 2. AWS — account and cost control

> **No AWS account yet? Start with [`AWS-SETUP.md`](AWS-SETUP.md)** — signup,
> the Free plan choice, root MFA, budget alert, Bedrock model access, IAM keys
> and S3, step by step. Come back here afterwards.

**Do the budget alert before anything else.** Bedrock is pay-per-token and
there is no free tier for it.

1. Sign up at [aws.amazon.com](https://aws.amazon.com). Choose the **Free
   Plan** at signup if offered — credits act as a hard cap rather than rolling
   into a bill.
2. Set a budget: **Billing and Cost Management → Budgets → Create budget →
   Zero spend** (or a $5 cost budget) with an email alert.
3. Enable MFA on the root account, then stop using root.

---

## 3. AWS — Bedrock model access

Model access is **per account and per region**, and it is not instant. Start
it early.

1. Open the **Amazon Bedrock** console. Set your region first (top right) —
   `us-east-1` has the widest model availability. This must match `AWS_REGION`.
2. In the left nav, under **Bedrock configurations**, choose **Model access**.
3. Choose **Modify model access**.
4. Select the models you need:
   - an **Anthropic Claude** model (the LLM)
   - **Amazon Titan Text Embeddings V2** (the embedder, 1024 dims)
5. Anthropic models require a **first-time use form** — choose **Submit use
   case details**, fill it in, and submit. This is once per account.
6. Wait for **Access granted**. Titan is usually immediate; Anthropic can take
   longer.

> Your AWS account needs a valid payment method configured for AWS Marketplace
> purchases, even where the models themselves are pay-per-use.

**A granted-access failure looks like a credentials failure.** If you get
`AccessDeniedException` with valid keys, the credentials are fine and the
model grant is missing — or you are in the wrong region.

### Create access keys

Do **not** use root keys.

1. **IAM → Users → Create user**.
2. Attach a policy granting Bedrock invoke permissions (`AmazonBedrockFullAccess`
   is the quick option; a policy limited to `bedrock:InvokeModel` and
   `bedrock:Converse` is the better one).
3. **Security credentials → Create access key → Application running outside
   AWS**. Copy both values; the secret is shown once.

### Configure

```sh
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
PROVIDER=bedrock
EMBEDDING_PROVIDER=titan
```

Check it:

```sh
npm test -- providers      # the 2 skipped Bedrock tests should now run
```

### ⚠ Before you switch `EMBEDDING_PROVIDER` to `titan`

Vectors are only comparable to other vectors from the same model. Switching
embedders means **re-embedding all ~257,000 name variants** — hours of wall
clock at Titan's one-input-per-call rate, and real spend.

The evaluation in `eval/results.md` was measured on the local trigram
embedder, which is a genuine lexical embedder rather than noise. You do not
need Titan for the numbers to be honest. Switch it only if you specifically
want to claim Titan in the submission, and budget the time.

---

## 4. Groq — optional fallback

Two minutes, free tier, and it gives you a real answer to "what happens when
Bedrock throttles?"

1. Sign up at [console.groq.com](https://console.groq.com).
2. **API Keys → Create API Key**. Copy it.
3. `GROQ_API_KEY=gsk_...`

Switching is one env var: `PROVIDER=groq`. No code change — nothing outside
`src/providers/` imports an SDK.

---

## 5. CockroachDB Cloud MCP — optional

Gives the agent read-only schema-exploration tools against your cloud cluster.

1. In the CockroachDB Cloud console, create a **service account**.
2. Grant it a **read-only** role, **scoped to the cluster**. This is the real
   enforcement: every tool call is checked against Cloud RBAC before it runs,
   so a read-only service account cannot be talked into a write.
3. Create an **API key** for that service account and copy it.
4. `CRDB_MCP_API_KEY=...`

The client authenticates with `Authorization: Bearer <key>` and additionally
refuses any tool whose name implies a mutation, even if the server marks it
read-only — see `src/mcp/readonly.ts`. Belt and braces, deliberately: the RBAC
role is the guarantee, the local gate is the insurance.

---

## Where each value goes

| Where | Which values | How |
|---|---|---|
| Local engine | everything | `.env` in the repo root (gitignored) |
| Local console | `DATABASE_URL` | `web/.env.local` (gitignored) |
| Vercel | `DATABASE_URL` | Settings → Environment Variables → Production |

Never commit any of these. `.env`, `.env.local` and `web/.env.local` are all
gitignored — check with `git status` before every push.

---

## Order I would actually do them in

1. **AWS budget alert.** Five minutes, prevents the only genuinely bad outcome.
2. **Bedrock model access request.** Submit it early; it is the one with a
   queue. You can carry on while it is pending.
3. **CockroachDB Cloud cluster + ingest + `DATABASE_URL` on Vercel.** This is
   the one that changes what a judge sees.
4. **Groq key.** Two minutes.
5. **MCP service account.** Only if there is time.

Nothing here blocks the demo video. All of it works locally today.
