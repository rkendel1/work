# Operations Inbox MVP

Minimal ingress-first backend for turning incoming operational information into actionable work.

## Stack (implemented in this repo)

- Rust
- Actix Web

## Implemented API

- `POST /ingest` — store raw incoming information as an `InboxItem`
- `POST /extract` — run deterministic rule extraction for an inbox item and create a `WorkItem`
- `GET /items` — list inbox items
- `GET /work` — list extracted work items

## Data Model

```rust
InboxItem {
  id,
  source,
  received_at,
  content,
}

WorkItem {
  id,
  inbox_item_id,
  title,
  summary,
  status,
}
```

## Rule-Based Extraction (V1)

Keyword-based deterministic classification:

- maintenance: `broken`, `down`, `not working`, `hvac`, `repair`, `issue`
- finance: `invoice`, `payment`
- scheduling: `schedule`, `appointment`
- fallback: general operational request

## Run

```bash
cd /tmp/workspace/rkendel1/work/services/ingress-engine
cargo run
```

## Test

```bash
cd /tmp/workspace/rkendel1/work/services/ingress-engine
cargo test
```
