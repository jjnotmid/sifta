# Setting up AWS from scratch

For someone who has never had an AWS account. About 45 minutes, most of it
waiting.

Nothing in this guide is required to run Sifta locally. It is required to
claim "Amazon Bedrock", "AWS Lambda" and "Amazon S3" in the submission, which
is a named judging criterion.

---

## Before you start

You will need:

- an email address not already used for an AWS account
- a phone that can receive an SMS or a call
- a **debit or credit card enabled for international transactions**

> **If you are in Nigeria:** most bank cards are *not* enabled for
> international online transactions by default. Check with your bank first —
> this is the single most common place this process stalls. Naira cards on
> Verve will not work; you need a Visa or Mastercard with international
> transactions turned on. AWS places a small temporary authorisation
> (around $1) to verify the card and reverses it.

---

## Step 1 — Create the account, and pick the right plan

Go to [aws.amazon.com](https://aws.amazon.com) and choose **Create an AWS
Account**.

1. Enter your email and choose an **AWS account name** (e.g. `sifta`).
2. Verify the email with the code they send.
3. Set a root password. Use a password manager.
4. Choose **Personal** account type, and fill in your details.
5. Enter the card. Expect the ~$1 verification hold.
6. Verify your phone number by SMS or call.
7. **Choose the Free plan.** This is the important step.
8. Choose the **Basic support** plan (free).

### Why the Free plan matters

Since July 2025, every new AWS account picks **Free** or **Paid** at signup.

| | Free plan | Paid plan |
|---|---|---|
| Credits | $100, up to $200 with onboarding tasks | Same |
| If credits run out | Account expires — **you are not billed** | You start paying |
| Duration | 6 months, or until credits are gone | Indefinite |

The Free plan is what makes the PRD's "$0 cost target" real: credits act as a
hard ceiling instead of rolling into a bill. There is no longer a 12-month
free tier for EC2/RDS/S3 — that ended for new accounts. You are getting
credits with an expiry, not a year of free usage.

You can upgrade Free → Paid later. You cannot easily go back.

---

## Step 2 — Lock down the root account

Do this immediately, before anything else.

1. Sign in as root. Top-right menu → **Security credentials**.
2. **Multi-factor authentication (MFA) → Assign MFA device.** Use an
   authenticator app.
3. Do **not** create access keys for root. If AWS offers, decline.

Root is for billing and account settings only. Everything else uses IAM.

---

## Step 3 — Set a budget alert (and earn $20)

This is both a safety net and one of the five credit-earning tasks.

1. Search **Billing and Cost Management** in the top search bar.
2. **Budgets → Create budget**.
3. Choose **Zero spend budget** (alerts on any charge at all) or a **Cost
   budget** of $5.
4. Enter your email for alerts. Create it.

On the Free plan you should never be charged — but a budget alert is how you
find out immediately if something is misconfigured, rather than at
month-end.

---

## Step 4 — Get Bedrock model access (and earn $20)

Model access is granted **per account and per region**, and Anthropic models
need a one-time form. Start this early; it is the step with a queue.

1. Search for **Bedrock** and open the console.
2. **Set your region in the top-right first.** Use **`us-east-1`
   (N. Virginia)** — it has the widest model availability. Whatever you pick
   must match `AWS_REGION` in your `.env`.
3. Left nav → under **Bedrock configurations** → **Model access**.
4. **Modify model access**.
5. Tick:
   - an **Anthropic Claude** model
   - **Amazon Titan Text Embeddings V2**
6. For Anthropic, choose **Submit use case details** and fill in the
   first-time-use form. Describe it honestly — sanctions screening research
   for a hackathon project.
7. Submit, and wait for the status to become **Access granted**. Titan is
   usually immediate. Anthropic can take from minutes to a day.

While you are there, open the **Bedrock playground** and run one prompt. That
is the "test a prompt in Amazon Bedrock" onboarding task — another $20.

> **The failure mode to recognise:** if you later get `AccessDeniedException`
> with credentials you know are valid, the credentials are not the problem.
> Either the model grant has not come through, or you are pointed at a region
> where you did not request it.

---

## Step 5 — Create an IAM user and access keys

Never use root credentials in an application.

1. Search **IAM** → **Users** → **Create user**.
2. Name it `sifta-app`. Do **not** tick console access — this identity is for
   the application only.
3. **Attach policies directly.** For speed, attach
   `AmazonBedrockFullAccess`. If you would rather be precise, create a policy
   allowing only `bedrock:InvokeModel` and `bedrock:Converse`.
4. Create the user, then open it → **Security credentials** → **Create access
   key** → **Application running outside AWS**.
5. Copy **both** values now. The secret is shown exactly once.

---

## Step 6 — Wire it into Sifta

Create `.env` in the repo root (it is gitignored — check with `git status`):

```sh
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Switch the LLM over. Leave embeddings on mock for now — see the warning.
PROVIDER=bedrock
EMBEDDING_PROVIDER=mock
```

Check it worked:

```sh
npm test -- providers
```

The two Bedrock integration tests stop skipping and actually run. If they
fail, read the error: `AccessDeniedException` is a model grant or region
problem, not a key problem.

### ⚠ Do not switch `EMBEDDING_PROVIDER` to `titan` yet

Vectors are only comparable to vectors from the same model, so changing the
embedder means **re-embedding all ~257,000 name variants**. That is hours of
wall clock and real credit spend, and it invalidates the numbers already in
`eval/results.md` until you re-run the evaluation.

The measured results were produced with the local trigram embedder, which is
a genuine lexical embedder rather than noise. They are honest as they stand.
Only switch if you specifically want to claim Titan embeddings in the
submission, and budget an afternoon for it.

---

## Step 7 — Create an S3 bucket

Needed for Phase 7 (raw list snapshots and audit exports).

1. Search **S3** → **Create bucket**.
2. Name it something globally unique, e.g. `sifta-artifacts-<your-initials>`.
3. Region: the same one you used for Bedrock.
4. Leave **Block all public access ON**. This bucket holds sanctions data and
   audit exports; nothing in it should ever be public.
5. Create.

Add to `.env`:

```sh
S3_BUCKET=sifta-artifacts-xyz
```

---

## Earning the full $200

Five onboarding tasks, $20 each. Three of them are things this project needs
anyway:

| Task | Needed for Sifta? |
|---|---|
| Set up a cost budget | Yes — step 3 |
| Test a prompt in Amazon Bedrock | Yes — step 4 |
| Deploy a Lambda function | Yes — Phase 7 |
| Launch and terminate an EC2 instance | No — but it is 5 minutes |
| Configure an RDS database | No — skip unless you want the $20 |

If you do the EC2 one, **terminate the instance immediately afterwards**. A
running instance is the most common way people burn credits without noticing.

---

## Staying at zero

- The budget alert from step 3 is your tripwire.
- Bedrock is pay-per-token. A handful of test calls costs cents. Re-embedding
  257,000 variants does not.
- Check **Billing → Bills** once a week during the build.
- Terminate anything you spun up to earn credits.

---

## What to do if you get stuck

| Symptom | Cause |
|---|---|
| Card declined at signup | International transactions not enabled — call your bank |
| `AccessDeniedException` with valid keys | Model access not granted, or wrong region |
| Model not listed in Bedrock console | Not available in that region — try `us-east-1` |
| `UnrecognizedClientException` | Access key wrong or truncated on copy |
| Tests still skipping | `AWS_ACCESS_KEY_ID` not exported — the suite checks for it |

---

## After this

Back to [`ACCOUNTS.md`](ACCOUNTS.md) for CockroachDB Cloud, which is the one
that actually changes what a judge sees on the deployed site.
