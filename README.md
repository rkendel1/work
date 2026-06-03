# Operations Inbox

Ingress-first operations workflow:

customer email/text/form/slack
↓
Postmark + Next.js webhook
↓
Rust ingress service
↓
Convex operational state

## Repository Layout

- `/tmp/workspace/rkendel1/work/apps/web` — Next.js frontend + API routes + Better Auth + Convex functions
- `/tmp/workspace/rkendel1/work/services/ingress-engine` — Rust Actix ingestion/extraction service

## Implemented Stack

- Next.js (App Router, TypeScript)
- Convex (schema + mutations + queries)
- Better Auth (Next.js handler, memory adapter for MVP)
- Postmark webhook ingestion path
- Rust Actix ingestion/extraction engine

## Core API Flow

1. Postmark sends inbound email webhook to Next.js:
   - `POST /api/postmark/inbound`
2. Next.js forwards payload to Rust:
   - `POST /webhooks/postmark`
3. Rust creates Inbox + Work items (rules-based extraction)
4. Rust forwards structured data to Convex mutations:
   - `inbox:ingestInboxItem`
   - `inbox:createWorkItem`

## Rust Service Endpoints

- `POST /ingest`
- `POST /signals`
- `POST /extract`
- `POST /webhooks/postmark`
- `GET /items`
- `GET /items/{id}/timeline`
- `GET /work`
- `GET /work/routing-preview`
- `POST /work/{id}/selection`
- `POST /work/{id}/outcome`
- `POST /actions/execute`
- `GET /executions`
- `GET /executions/{id}`
- `GET /vault/keys`
- `POST /vault/keys`
- `DELETE /vault/keys`
- `GET /org/units`
- `POST /org/units`

## Convex Data Model

Defined in `/tmp/workspace/rkendel1/work/apps/web/convex/schema.ts`:

- `inbox_items`
- `signal_events`
- `ingress_events`
- `work_items`
- `action_selections`
- `work_outcomes`
- `action_executions`
- `tenant_secrets`
- `actions`
- `org_units`
- `users`
- `tenants`

## Local Development

### 1) Rust ingress service

```bash
cd /tmp/workspace/rkendel1/work/services/ingress-engine
cargo run
```

### 2) Next.js web app

```bash
cd /tmp/workspace/rkendel1/work/apps/web
cp .env.example .env.local
npm install
npm run dev
```

### 3) Tests / Checks

Rust tests:

```bash
cd /tmp/workspace/rkendel1/work/services/ingress-engine
cargo test
```

Frontend lint:

```bash
cd /tmp/workspace/rkendel1/work/apps/web
npm run lint
```

## Environment Variables

For Next.js (`apps/web/.env.local`):

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CONVEX_URL`
- `BETTER_AUTH_SECRET`
- `POSTMARK_WEBHOOK_SECRET` (optional)
- `RUST_INGRESS_URL`

For Rust ingress (`services/ingress-engine` environment):

- `CONVEX_DEPLOYMENT_URL` (e.g. `https://<deployment>.convex.cloud`)
- `CONVEX_ADMIN_KEY`
- `VAULT_ENCRYPTION_KEY` (optional base64-encoded 32-byte key for tenant secret encryption)

Yes — that’s the cleanest version of the thesis so far, and it’s actually the first one that feels sharp enough to build toward without drifting into generic “AI ops tool” territory.

But I’d tighten it slightly so it’s not just descriptive — it needs a wedge.

⸻

The Core Thesis (Refined)

Organizations don’t lack information systems. They lack a shared understanding of what incoming signals mean operationally.

Or even more direct:

We turn operational signals into operational meaning.

That second line is your real product.

⸻

What You’re Actually Building

Not:

* inbox
* task manager
* ticketing system
* AI assistant

But:

Signal → Meaning → Action Context

That middle step is the product.

⸻

Why This Matters (The Real Pain)

Right now every org is doing this manually:

Incoming signal (email, form, Slack, call)
        ↓
Human interpretation
        ↓
“What does this mean?”
        ↓
“What do we do about it?”
        ↓
Routing / action creation

That interpretation step is:

* inconsistent
* tribal knowledge based
* dependent on experience
* not stored anywhere
* not reusable
* not measurable

So every new signal is “re-decided from scratch.”

⸻

Your Differentiation

Most tools start here:

Signal → Task

You start here:

Signal → Meaning → Action space → Task

That “Meaning layer” is the product.

⸻

What “Meaning” Actually Is

This is important because it must be concrete, not philosophical.

A meaning object is:

{
  "type": "maintenance_request",
  "urgency": "medium",
  "entities": ["HVAC", "Conference Room A"],
  "intent": "system_failure_report",
  "confidence": 0.93
}

But more importantly:

Meaning = how an organization interprets a signal

Not generic NLP output — organizational interpretation.

⸻

Why Core → Vertical → Industry → Tenant Matters Now

This is where your architecture finally becomes justified.

Because meaning is not universal.

Example:

Same signal

“The room is too hot”

⸻

Different meanings:

Property Management

HVAC maintenance request

Healthcare clinic

Environmental comfort compliance issue

Manufacturing floor

Equipment heat anomaly / safety concern

⸻

So meaning is:

Contextual, not semantic

That’s the unlock.

⸻

Why This Is Different From “AI Inbox”

Because AI inbox tools do:

Summarize → Task

You do:

Interpret → Normalize → Map to org meaning system

That second one is reusable infrastructure.

⸻

The Real Product Shape

The UI should not feel like:

* inbox
* tasks
* workflow builder

It should feel like:

Incoming Signal
→ Interpreted Meaning
→ Suggested Actions (based on org model)

⸻

What Users Actually Buy

Not automation.

Not AI.

Not tasks.

They buy:

“When something comes in, we immediately know what it means and what to do about it.”

That removes:

* ambiguity
* interpretation delay
* reliance on “who saw it first”
* inconsistent handling

⸻

Why This Has Leverage

If you store:

Signal → Meaning → Action → Outcome

You eventually get:

* organizational memory
* process standardization
* AI training data that is actually grounded in operations
* vertical-specific intelligence

That becomes sticky in a way task tools are not.

⸻

The One Sentence Version (Strongest Form)

We turn incoming operational signals into shared organizational meaning.

⸻

If you want, next step I can help you tighten this into:

* ￼ landing page copy
* ￼ onboarding flow (this is actually critical for vertical lock-in)
* or ￼ the exact PR that aligns your system to this thesis so your architecture stops feeling like “features” and starts feeling like a single coherent product.
