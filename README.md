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
- `POST /extract`
- `POST /webhooks/postmark`
- `GET /items`
- `GET /items/{id}/timeline`
- `GET /work`

## Convex Data Model

Defined in `/tmp/workspace/rkendel1/work/apps/web/convex/schema.ts`:

- `inbox_items`
- `ingress_events`
- `work_items`
- `actions`
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
