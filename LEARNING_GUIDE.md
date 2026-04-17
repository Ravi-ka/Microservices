# 📚 GCP Microservices Learning Guide

A complete walkthrough of **why** each piece of this project exists and **how** to use it. This guide is meant to teach you Terraform, CI/CD pipelines, and cloud deployments on GCP — using a small Node.js/TypeScript microservices project as the vehicle.

---

## Table of Contents

1. [Big picture architecture](#1-big-picture-architecture)
2. [The tech stack — what & why](#2-the-tech-stack--what--why)
3. [Monorepo structure explained](#3-monorepo-structure-explained)
4. [The microservices (Node.js / TypeScript)](#4-the-microservices-nodejs--typescript)
5. [Google Cloud Platform concepts](#5-google-cloud-platform-concepts)
6. [Terraform — deep dive](#6-terraform--deep-dive)
7. [CI/CD with GitHub Actions](#7-cicd-with-github-actions)
8. [Workload Identity Federation (keyless auth)](#8-workload-identity-federation-keyless-auth)
9. [Step-by-step setup (first-time)](#9-step-by-step-setup-first-time)
10. [Day-to-day workflow](#10-day-to-day-workflow)
11. [Troubleshooting](#11-troubleshooting)
12. [Cost & free tier notes](#12-cost--free-tier-notes)
13. [Learning roadmap / next steps](#13-learning-roadmap--next-steps)
14. [Glossary](#14-glossary)

---

## 1. Big picture architecture

```
┌─────────────────┐        ┌───────────────────────┐
│  Developer      │ push   │    GitHub Repo        │
│  (your laptop)  ├───────▶│  (code + workflows)   │
└─────────────────┘        └──────────┬────────────┘
                                      │ triggers
                                      ▼
                           ┌──────────────────────┐
                           │  GitHub Actions CI/CD│
                           │  - lint/test/build   │
                           │  - terraform plan    │
                           │  - terraform apply   │
                           └──────���───┬───────────┘
                                      │ auth via WIF (no keys!)
                                      ▼
        ┌─────────────────────────────────────────────────────┐
        │                    Google Cloud                     │
        │                                                     │
        │  ┌──────────────┐   ┌──────────────┐                │
        │  │ user-service │   │ order-service│  Cloud Functions│
        │  │   (Gen 2)    │   │   (Gen 2)    │  (Gen 2 = Cloud │
        │  └──────┬───────┘   └──────┬───────┘   Run under the │
        │         │                  │           hood)         │
        │         ▼                  ▼                         │
        │  ┌────────────────────────────────────┐              │
        │  │  (future) Firestore / Pub/Sub      │              │
        │  └────────────────────────────────────┘              │
        │                                                     │
        │  ┌──────────────────────────────────────┐           │
        │  │  GCS bucket: terraform state          │           │
        │  └──────────────────────────────────────┘           │
        └─────────────────────────────────────────────────────┘
```

**The flow:**
1. You write code locally → push to GitHub.
2. GitHub Actions runs tests, builds the TypeScript, plans infra.
3. On merge to `main`, GitHub Actions authenticates to GCP **without any JSON keys** using Workload Identity Federation.
4. Terraform provisions/updates Cloud Functions; your code gets deployed.
5. Your functions are now reachable over HTTPS.

---

## 2. The tech stack — what & why

| Tool / Service | What it is | Why we use it |
|---|---|---|
| **Node.js 20** | JS runtime for servers | Huge ecosystem, fast iteration, supported natively by GCP Cloud Functions. |
| **TypeScript** | Typed superset of JS | Catches bugs at compile time, much better DX than plain JS. |
| **Functions Framework** | GCP's open-source HTTP wrapper | Lets you run the same function locally and in GCP with zero code changes. |
| **Jest** | Test framework | De-facto standard for JS/TS testing; easy mocks, fast. |
| **ESLint + Prettier** | Lint + auto-format | Consistent code style; prevents bike-shedding in PRs. |
| **npm workspaces** | Monorepo support | Share deps and tooling across services without extra tools like Lerna. |
| **GCP Cloud Functions Gen 2** | Serverless HTTP functions | No server mgmt; scales to zero; generous free tier. |
| **GCP Cloud Storage (GCS)** | Object storage | Stores Terraform state + function source zips. |
| **Terraform** | Infrastructure as Code | Declarative, versioned, reviewable, cloud-agnostic. |
| **GitHub Actions** | CI/CD runner | Free for public repos & generous for private; tight GitHub integration. |
| **Workload Identity Federation (WIF)** | Keyless GCP auth for CI | Avoids storing long-lived JSON keys — major security win. |

---

## 3. Monorepo structure explained

```
gcp-microservices-learning/
├── .github/workflows/         ← CI/CD pipeline definitions
├── services/                  ← Each folder = one microservice
│   ├── user-service/
│   └── order-service/
├── infra/
│   ├── bootstrap/             ← One-time infra (state bucket, WIF, SA)
│   ├── modules/               ← Reusable TF modules (DRY)
│   └── envs/
│       ├── dev/               ← Dev environment config
│       └── prod/              ← Prod environment config
├── package.json               ← Root — defines workspaces + shared devDeps
├── .eslintrc.json / .prettierrc
└── README.md
```

**Why monorepo?**
- One place to clone, one place to CI.
- Atomic commits across services + infra (update API + consumer + Terraform in one PR).
- Easier for learning — less context-switching.

**Why separate `bootstrap/` from `envs/`?**
- Bootstrap creates the things Terraform itself *depends on* (state bucket, auth). It must run **before** anything else, and usually only once, locally, with local state.

**Why separate `dev/` and `prod/`?**
- Different state files → can't accidentally destroy prod while working on dev.
- Different variables, different approval gates.
- Industry-standard pattern.

---

## 4. The microservices (Node.js / TypeScript)

### Why GCP Functions Framework?

The `@google-cloud/functions-framework` library lets you:
- Run your function **locally** with `functions-framework --target=userService` (acts like Express).
- Deploy the **same code** to GCP with no changes.

It's a thin HTTP wrapper — your function signature is `(req, res) => void` just like Express.

### File: `services/user-service/src/index.ts`

```ts
import { http, Request, Response } from '@google-cloud/functions-framework';

export const handler = (req: Request, res: Response): void => {
  // route based on method + path
};

http('userService', handler);   // register with framework
```

**Key points:**
- `http('userService', handler)` registers an HTTP-triggered function named `userService`. This name is the **entry point** Terraform references.
- Terraform deploys each service as a separate Cloud Function.

### How to run locally

```bash
cd services/user-service
npm install
npm run build     # compile TS → JS into dist/
npm start         # launches functions-framework on :8080
curl http://localhost:8080/health
```

### How to test

```bash
npm test
```

Jest + `ts-jest` runs your `.test.ts` files. Tests mock `req` and `res` — no GCP needed.

---

## 5. Google Cloud Platform concepts

### 5.1 GCP Project

A **project** is the top-level container for resources, billing, and IAM. You'll create one (e.g. `my-learning-proj-123`) and all resources live inside it.

**Why:** Isolation. Delete the project → everything goes away. Perfect for learning.

### 5.2 APIs must be enabled

GCP APIs are off by default. The bootstrap Terraform enables:

| API | Why |
|---|---|
| `cloudfunctions.googleapis.com` | Deploy Cloud Functions |
| `run.googleapis.com` | Gen2 Functions run on Cloud Run under the hood |
| `cloudbuild.googleapis.com` | Builds your function source code |
| `artifactregistry.googleapis.com` | Stores the built container images |
| `iam.googleapis.com` / `iamcredentials.googleapis.com` | IAM & impersonation |
| `storage.googleapis.com` | GCS for state + source zips |
| `eventarc.googleapis.com` | Used by Gen2 triggers |

### 5.3 Cloud Functions Gen 2 vs Gen 1

We use **Gen 2**:
- Built on Cloud Run (more resources, longer timeouts, concurrent requests).
- Cleaner pricing, better performance.
- Gen 1 is in maintenance mode.

### 5.4 IAM in one paragraph

IAM = **Who** (identity) can do **what** (role) on **which** resource. Roles are bundles of permissions (e.g. `roles/cloudfunctions.admin`). We grant roles to a **service account** which the CI uses.

### 5.5 Service Accounts

A **service account (SA)** is a non-human identity. In this project:
- `gha-deployer@<project>.iam.gserviceaccount.com` — impersonated by GitHub Actions to deploy.
- Each Cloud Function also has a **runtime SA** (default is the Compute SA; you can override).

### 5.6 Free tier quick facts (us-central1)

- Cloud Functions: **2M invocations/month** free.
- Cloud Run: **2M requests/month**, 360k vCPU-sec, 180k GiB-sec memory free.
- Cloud Storage: **5 GB standard** free.
- Firestore: **1 GiB storage, 50k reads, 20k writes per day** free.
- Egress: **1 GB/month** out of North America free.

> 💡 Billing must still be enabled. Add budget alerts!

---

## 6. Terraform — deep dive

### 6.1 Why Terraform?

- **Declarative:** describe desired state, TF figures out the diff.
- **Versioned:** infra lives in Git, reviewed like code.
- **Reproducible:** `terraform apply` → same result every time.
- **Multi-cloud:** same syntax for AWS, Azure, GCP, etc.

### 6.2 Core concepts

| Concept | What it is |
|---|---|
| **Provider** | Plugin that talks to a cloud (e.g. `hashicorp/google`). |
| **Resource** | A thing to create (e.g. `google_cloudfunctions2_function`). |
| **Data source** | Read-only lookup (e.g. existing bucket). |
| **Module** | Reusable bundle of resources with inputs/outputs. |
| **State** | JSON file mapping config → real resources. Critical! Never lose it. |
| **Backend** | Where state lives. We use `gcs` (a GCS bucket). |
| **Variable** | Typed input (string/number/object). |
| **Output** | Value exposed after apply (e.g. function URL). |

### 6.3 Terraform lifecycle commands

```bash
terraform init        # download providers, configure backend
terraform fmt         # auto-format .tf files
terraform validate    # syntax + type check
terraform plan        # show what WILL change (never mutates)
terraform apply       # actually create/update resources
terraform destroy     # tear everything down
terraform output      # show output values
terraform state list  # list managed resources
```

**Golden rule:** always `plan` before `apply`. In CI, `plan` runs on PRs so reviewers can see infra changes.

### 6.4 Why remote state in GCS?

Local state (`terraform.tfstate` on your laptop) breaks the moment a second person (or CI) runs TF. Remote state:
- **Shared** between you and CI.
- **Locked** during apply (prevents concurrent mutations).
- **Versioned** (our bucket has versioning on → can roll back).

Our config:
```hcl
terraform {
  backend "gcs" {
    bucket = "<project>-tf-state"
    prefix = "envs/dev"     # different prefix per env
  }
}
```

### 6.5 Why bootstrap is separate

Chicken-and-egg: Terraform wants to store state in GCS, but GCS bucket must exist first. Solution: `infra/bootstrap/` uses **local state** and creates the bucket + WIF once. After that, everything else uses remote state.

### 6.6 Why modules?

`infra/modules/cloud-function/` wraps the repetitive bits (zip source → upload to GCS → create function → grant public invoke). Both services call this module with different inputs → DRY.

```hcl
module "user_service" {
  source      = "../../modules/cloud-function"
  name        = "user-service"
  entry_point = "userService"
  source_dir  = "${path.root}/../../../services/user-service/dist"
  # ...
}
```

### 6.7 How a deploy works mechanically

1. TS is compiled → `services/user-service/dist/*.js`.
2. Terraform's `archive_file` zips that folder.
3. `google_storage_bucket_object` uploads the zip to GCS.
4. `google_cloudfunctions2_function` tells GCP to:
   - Pull the zip
   - Build a container via Cloud Build
   - Push to Artifact Registry
   - Run on Cloud Run under a generated URL
5. Output block prints that URL.

### 6.8 When state drifts

If someone tweaks a resource in the GCP console, TF state is now out of date. Fix by:
- `terraform plan` → shows the drift.
- Either: revert manual change, **or** update TF to match, **or** `terraform import`.

---

## 7. CI/CD with GitHub Actions

### 7.1 Why GitHub Actions?

- Lives next to your code — no extra SaaS.
- Free minutes for private repos (2,000/month) and unlimited for public.
- First-class GCP auth via the `google-github-actions/auth` action.

### 7.2 Our three workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR to `main` | Quality gate — lint, test, `terraform plan` |
| `deploy-dev.yml` | Push to `main` | Deploy to dev automatically |
| `deploy-prod.yml` | Manual / GitHub Release | Deploy to prod with approval |

### 7.3 Anatomy of a workflow

```yaml
name: CI
on:
  pull_request:
    branches: [main]          # when to run

permissions:                   # least-privilege GITHUB_TOKEN
  contents: read
  id-token: write              # REQUIRED for WIF — the OIDC token

jobs:
  test:
    runs-on: ubuntu-latest     # runner image
    steps:
      - uses: actions/checkout@v4          # get code
      - uses: actions/setup-node@v4        # install Node
        with: { node-version: 20, cache: npm }
      - run: npm ci                        # install
      - run: npm run lint
      - run: npm test
```

### 7.4 Key pieces explained

**`id-token: write`** — lets the job request an OIDC token from GitHub. That token is what GCP trusts via WIF. Without this, auth fails.

**`environment: prod`** — the magic that enables manual approval. In repo Settings → Environments → `prod`, add required reviewers.

**`needs: test`** — job dependency. `terraform-plan` only runs if `test` passed.

**Secrets we use:**
- `GCP_WIF_PROVIDER` — full resource name of the WIF provider (output from bootstrap).
- `GCP_DEPLOYER_SA` — email of the deployer SA.

> Notice: **no JSON key.** WIF exchanges the GitHub OIDC token for a short-lived GCP access token.

### 7.5 The typical flow

```
PR opened
  └── ci.yml runs: lint ✓ test ✓ tf plan ✓   → reviewers approve
                                             → merge

Merge to main
  └── deploy-dev.yml runs: build ✓ test ✓ tf apply (dev) ✓ → functions live in dev

Ready to ship
  └── Actions tab → "Deploy Prod" → Run workflow
      └── deploy-prod.yml starts → PAUSES on "prod" environment
          └── Required reviewer clicks "Approve"
              └── tf apply (prod) ✓ → functions live in prod
```

---

## 8. Workload Identity Federation (keyless auth)

### 8.1 The old, bad way

1. Create an SA key → download a JSON file.
2. Paste it into GitHub secrets.
3. Hope it never leaks. Rotate manually (nobody does).

### 8.2 The WIF way

1. GitHub gives each workflow a short-lived **OIDC token** claiming "I'm repo X, branch Y, actor Z."
2. GCP's WIF provider validates that token against rules you set.
3. If allowed, GCP hands back a short-lived access token for the SA.
4. Token expires in ~1 hour. Nothing to leak long-term.

### 8.3 How we set it up (in `infra/bootstrap/main.tf`)

```hcl
# 1. A pool (container for external identities)
resource "google_iam_workload_identity_pool" "github" { ... }

# 2. A provider (tells GCP to trust GitHub's OIDC issuer)
resource "google_iam_workload_identity_pool_provider" "github" {
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }

  # CRITICAL: restrict which repo can assume the identity
  attribute_condition = "assertion.repository == \"owner/repo\""
}

# 3. Allow GitHub workflows from that repo to impersonate our SA
resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.gha_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://.../attribute.repository/owner/repo"
}
```

**The `attribute_condition` is your security.** Without it, *any* GitHub repo on Earth could use your WIF provider.

---

## 9. Step-by-step setup (first-time)

### ✅ Prerequisites

- `gcloud` CLI installed & logged in (`gcloud auth login`).
- `terraform` ≥ 1.5 installed.
- `node` 20 + `npm` installed.
- A Google account with a billing method attached.

### Step 1 — Create a GCP project

```bash
PROJECT_ID=my-learning-proj-$RANDOM
gcloud projects create $PROJECT_ID --name="Learning"
gcloud config set project $PROJECT_ID

# Link billing (required even for free tier)
gcloud beta billing accounts list
gcloud beta billing projects link $PROJECT_ID \
  --billing-account=XXXXXX-XXXXXX-XXXXXX
```

### Step 2 — Create the GitHub repo

Either via UI or:
```bash
gh repo create gcp-microservices-learning --private --source=. --remote=origin
```

Copy all the scaffold files from the previous message into this repo.

### Step 3 — Run the bootstrap Terraform locally

```bash
cd infra/bootstrap
terraform init
terraform apply \
  -var="project_id=$PROJECT_ID" \
  -var="github_owner=YOUR_GITHUB_USER" \
  -var="github_repo=gcp-microservices-learning"
```

Copy these outputs — you'll need them:
- `tf_state_bucket`              (e.g. `my-learning-proj-123-tf-state`)
- `workload_identity_provider`   (long path: `projects/.../providers/github-provider`)
- `deployer_service_account`     (e.g. `gha-deployer@my-learning-proj-123.iam.gserviceaccount.com`)

### Step 4 — Fill in the placeholders

In these files replace `REPLACE_WITH_YOUR_PROJECT_ID`:
- `infra/envs/dev/backend.tf`
- `infra/envs/dev/terraform.tfvars`
- `infra/envs/prod/backend.tf`
- `infra/envs/prod/terraform.tfvars`

### Step 5 — Add GitHub secrets

GitHub → Repo → Settings → Secrets and variables → Actions → New repository secret:

| Name | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `projects/NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOYER_SA`  | `gha-deployer@<project>.iam.gserviceaccount.com` |

### Step 6 — Configure environments

Settings → Environments:
1. Create `dev` (no protections).
2. Create `prod` → **check "Required reviewers"** → add yourself.

### Step 7 — Push and watch it fly

```bash
git add .
git commit -m "Initial scaffold"
git push origin main
```

Go to the **Actions** tab → watch `Deploy Dev` run → click on it → grab the output URL → `curl` it!

### Step 8 — First prod deploy

Actions → `Deploy Prod` → **Run workflow** → wait for approval gate → click **Review deployments** → Approve.

---

## 10. Day-to-day workflow

```bash
# 1. Create feature branch
git checkout -b feat/add-thing

# 2. Code + build + test locally
cd services/user-service
npm run build
npm test
npm start   # smoke-test via curl

# 3. Commit & push
git commit -am "feat: add new route"
git push -u origin feat/add-thing

# 4. Open PR → CI runs → review tf plan output → merge

# 5. Merge → dev deploy auto-triggers

# 6. Validate in dev

# 7. Trigger prod deploy manually (Actions tab)
```

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `google: could not find default credentials` locally | Not authed | `gcloud auth application-default login` |
| CI auth fails: `Unable to acquire impersonation credentials` | WIF binding wrong / repo name mismatch | Check `attribute_condition` in bootstrap; must match `owner/repo` exactly |
| `terraform plan` prompts for project_id interactively | tfvars missing or wrong path | Ensure `terraform.tfvars` is in the env folder |
| Function URL returns 403 | IAM not allowing `allUsers` | Check `google_cloud_run_service_iam_member.public` in module |
| `Error acquiring the state lock` | Previous run crashed | `terraform force-unlock <LOCK_ID>` (carefully) |
| Build fails: `No such file: dist/` | Forgot `npm run build` before TF | CI handles this; locally just build first |
| Cloud Build quota exceeded | Free tier limits | Wait, or switch build region, or enable billing |

---

## 12. Cost & free tier notes

**Things that can sneak up on you:**
- Artifact Registry storage (built images) — small but not zero.
- Cloud Build minutes if you redeploy a lot.
- Egress if you `curl` lots of data out.

**Protective measures:**
1. Set a **budget alert** in GCP Console → Billing → Budgets & alerts at e.g. **$5/month**.
2. Use `terraform destroy` on environments you're not using.
3. Keep `min_instance_count = 0` (already set) so functions scale to zero.

---

## 13. Learning roadmap / next steps

Work through these in order. Each builds a new TF/GCP skill:

1. **Add Firestore** to `order-service` → learn GCP IAM for runtime SAs.
2. **Add Pub/Sub** between services → learn event-driven, async patterns & Eventarc triggers.
3. **Add a `packages/shared/`** TS package → learn monorepo internal deps.
4. **Split Terraform** into more modules (`networking`, `iam`, `storage`) → learn composition.
5. **Add secrets** via Secret Manager + TF → learn secure config.
6. **Add monitoring dashboards** in TF → learn `google_monitoring_*` resources.
7. **Harden IAM** — replace `roles/*.admin` with custom least-privilege roles.
8. **Add integration tests** that hit deployed dev URLs.
9. **Blue/green or canary** deploys using Cloud Run revisions.
10. **Migrate to Cloud Run directly** (without Functions framework) → learn container-first deploys.

---

## 14. Glossary

- **IaC** — Infrastructure as Code.
- **Provider** (TF) — plugin that knows how to talk to a cloud/API.
- **State** (TF) — map between config and real resources.
- **Drift** — when real infra differs from state.
- **OIDC** — OpenID Connect; an identity token standard.
- **WIF** — Workload Identity Federation; GCP's mechanism to trust external OIDC tokens.
- **SA** — Service Account.
- **Gen 2 Function** — Cloud Functions running on Cloud Run infra.
- **Runner** — the VM GitHub Actions executes your job on.
- **Environment** (GHA) — a named target (dev/prod) with optional protection rules.

---

*Happy learning! Don't hesitate to break things in `dev` — that's what it's for.* 🚀