# Rust API Architecture Analysis (Current State + Refactor Target)

This document inventories what exists today in `/tmp/workspace/rkendel1/work/services/rust-api`, highlights architectural issues, and proposes a target modular architecture for an operations runtime engine.

## 1) Current system inventory by domain

### Ingestion Layer
- **Functions**
  - `ingest`, `ingest_signal`, `postmark_inbound`
  - `normalize_signal_content`, `create_signal_event`, `create_inbox_item`, `create_ingress_event`, `update_ingress_status`
  - `build_postmark_content`, `postmark_source`
- **Responsibilities**
  - Accepts raw payloads (`/ingest`, `/signals`, `/webhooks/postmark`)
  - Normalizes signal content and metadata
  - Creates inbox + ingress lifecycle records
  - Triggers work generation flow
- **Owned data**
  - `signal_events`, `inbox_items`, `ingress_events`
- **External dependencies touched**
  - Postmark payload contract
  - Convex forwarding (`inbox:createSignalEvent`, `inbox:ingestInboxItem`, `inbox:createIngressEvent`, `inbox:updateIngressStatus`)

### Classification + Meaning Layer
- **Functions**
  - `classify_content`, `extract_entities`, `classification_title`, `infer_operational_meaning`, `extract`
  - `tenant_recommendations` + `RuleBasedRecommendationEngine::generate` (`recommendation_engine.rs`)
- **Responsibilities**
  - Classifies normalized text and derives entities/priority
  - Computes operational meaning object
  - Produces recommended actions (pack + tenant-aware)
- **Owned data**
  - `classifications` definitions and inferred `operational_meaning` attached to `WorkItem`
- **External dependencies touched**
  - Convex forwarding via work payload (`operationalMeaning`, `recommendedActions`)

### Work Generation + Routing Layer
- **Functions**
  - `create_work_item`, `route_work_item`, `build_routing_path`
  - `work_routing_preview`, `list_work`, `list_items`
  - `select_work_action`, `record_work_outcome`, `item_timeline`
- **Responsibilities**
  - Creates work from ingress items
  - Applies assignment/routing path and captures operator selection/outcome
  - Maintains ingress/work lifecycle visibility
- **Owned data**
  - `work_items`, `action_selections`, `work_outcomes`
- **External dependencies touched**
  - Convex forwarding (`inbox:createWorkItem`, `inbox:recordActionSelection`, `inbox:recordWorkOutcome`)

### Tenant + Organization Layer
- **Functions**
  - `create_tenant`, `list_tenants`, `resolve_tenant_id`, `normalize_identifier`, `ensure_tenant_exists`
  - `org_units_from_pack`, `create_org_unit`, `list_org_units`, `ensure_default_org_unit`, `tenant_primary_org_unit_id`
  - `load_pack`, `actions_from_pack`, `classifications_from_pack`, `onboarding_seed_signals`
- **Responsibilities**
  - Tenant provisioning and tenant-scoped defaults
  - Organizational units and baseline operational packs
  - Tenant context resolution for all API paths
- **Owned data**
  - `tenants`, `org_units`, tenant-specific `actions` + `classifications`
- **External dependencies touched**
  - Convex tenant bootstrap (`actions:createTenant`, `actions:bootstrapTenantFromPack`)

### Business Rules Engine
- **Functions**
  - `create_business_rule`, `list_business_rules`
  - `extract_rule_keywords`, `parse_priority_override`, `evaluate_rule`, `apply_business_rules`
- **Responsibilities**
  - Stores rule definitions per tenant
  - Applies rule effects during routing/work construction
  - Emits applied-rule trace on work records
- **Owned data**
  - `business_rules`, `applied_rules` (inside work context)
- **External dependencies touched**
  - None directly; impacts downstream Convex work projection

### Actions + Execution Runtime
- **Functions**
  - `create_action`, `list_actions`, `execute_action`
  - `executor_for_provider`, `DirectExecutor::execute`, `NangoExecutor::execute`
  - `list_executions`, `get_execution`
- **Responsibilities**
  - Action catalog CRUD per tenant
  - Runtime action execution abstraction by provider
  - Persists execution results and side effects
- **Owned data**
  - `actions`, `execution_results`
- **External dependencies touched**
  - External provider shape (`nango` via executor choice)
  - Convex indirectly through execution-derived behavior refresh

### Vault / Secrets Layer
- **Functions**
  - `upsert_vault_key`, `list_vault_keys`, `delete_vault_key`, `tenant_secret_summary`
  - `VaultCrypto::from_env`, `VaultCrypto::encrypt`, `VaultCrypto::decrypt`
- **Responsibilities**
  - Tenant-scoped secret storage and retrieval
  - Encryption/decryption for provider credentials used by action runtime
- **Owned data**
  - `tenant_secrets`
- **External dependencies touched**
  - Env secret source: `VAULT_ENCRYPTION_KEY`
  - Execution layer consumption for external provider calls

### Simulation + Operational Intelligence Layer
- **Functions**
  - `simulate`
  - `infer_behavioral_patterns`, `refresh_behavioral_patterns_for_tenant`, `list_behavioral_patterns`
  - `infer_process_graph`, `format_process_name`, `get_process_graph`
  - `infer_operational_artifacts`, `list_operational_artifacts`
- **Responsibilities**
  - Test/simulate operational outputs
  - Infer behavior/process/artifact projections from runtime records
  - Expose policy/process intelligence endpoints
- **Owned data**
  - `behavioral_patterns`, `process_nodes`, `process_edges`, `operational_artifacts`
- **External dependencies touched**
  - Convex indirectly if projections are mirrored by web/Convex paths

### API + Integration Layer
- **Functions**
  - `routes::app_config` (all HTTP route binding)
  - `health`, `status`, `ingest_contract`, `router_debug`, `verify_router_mount`
  - `send_convex_mutation` and all `forward_*_to_convex` helpers
- **Responsibilities**
  - HTTP surface definition and contract/status endpoints
  - Convex mutation transport with admin key auth
  - CORS + Actix server bootstrapping (`main`)
- **Owned data**
  - None domain-specific; orchestration + transport glue
- **External dependencies touched**
  - Convex HTTP API (`/api/mutation`)
  - Actix Web runtime and Reqwest client

## 2) Architectural problems (specific)

- **Overloaded module:** `src/main.rs` contains nearly every domain model, service, route handler, and integration concern.
- **Hidden coupling:** domain logic depends on shared mutable `State` (`Mutex<State>`) with cross-domain vectors.
- **Duplicate responsibility in handlers:** ingestion endpoints perform classification, routing, eventing, and projection forwarding inline.
- **Missing abstractions:** no explicit service interfaces for ingestion pipeline, rules engine, routing engine, or projection writers.
- **HTTP/domain coupling:** route handlers are the domain orchestrators; no application service layer.
- **Boundary leakage:** tenant provisioning seeds actions/classifications/signals/work directly across multiple domains.
- **Transport/integration leakage:** Convex mutation payload shaping is mixed into domain flow instead of projection adapters.
- **Implicit global state:** in-memory vectors are de facto source of truth and also simulation substrate.
- **Rules entanglement:** business rules are string-parsed and applied inside work construction path with no standalone policy module contract.

## 3) Refactoring opportunities (module target)

### `ingestion/`
- **Responsibilities:** signal normalization, ingress lifecycle creation, webhook adapters.
- **Public API:** `IngestionService::ingest_raw`, `IngestionService::ingest_signal`, `WebhookAdapter::from_postmark`.
- **Internal services:** `Normalizer`, `IngressLifecycleStore`.
- **Should NOT contain:** routing/rules/action execution logic.

### `classification/`
- **Responsibilities:** deterministic classification + entity extraction + meaning inference + recommendations.
- **Public API:** `Classifier::classify`, `MeaningEngine::infer`, `RecommendationService::for_tenant`.
- **Internal services:** rule-based model, pack-aware recommendation registry.
- **Should NOT contain:** HTTP parsing, Convex transport calls.

### `routing/`
- **Responsibilities:** org-unit resolution, route path construction, routing preview generation.
- **Public API:** `Router::route_work`, `Router::preview`.
- **Internal services:** org graph resolver, escalation policy evaluator.
- **Should NOT contain:** ingest payload parsing, secret management.

### `tenancy/`
- **Responsibilities:** tenant lifecycle, pack provisioning, tenant context resolver.
- **Public API:** `TenantService::create`, `TenantService::resolve`, `TenantBootstrapper::provision_defaults`.
- **Internal services:** slug/domain policy, pack catalog.
- **Should NOT contain:** action execution runtime.

### `work/`
- **Responsibilities:** work aggregate lifecycle, action selection/outcome state transitions.
- **Public API:** `WorkService::create_from_ingress`, `WorkService::select_action`, `WorkService::record_outcome`.
- **Internal services:** state transition validator, timeline projector.
- **Should NOT contain:** provider-specific execution adapters.

### `actions/`
- **Responsibilities:** action catalog + execution orchestration.
- **Public API:** `ActionCatalog::create/list`, `ExecutionRuntime::execute`.
- **Internal services:** provider registry (`internal`, `nango`), execution ledger.
- **Should NOT contain:** tenant bootstrap seeding logic.

### `vault/`
- **Responsibilities:** encrypted tenant secret CRUD + provider credential resolution.
- **Public API:** `VaultService::upsert`, `VaultService::list`, `VaultService::delete`, `VaultService::resolve_provider_secrets`.
- **Internal services:** crypto key manager, cipher adapter.
- **Should NOT contain:** HTTP/webhook logic.

### `process_graph/` + `analytics/` + `simulation/`
- **Responsibilities:** projections and simulation read models.
- **Public API:** `BehavioralAnalytics::refresh`, `ProcessGraphService::build`, `SimulationService::run`.
- **Internal services:** projection calculators over domain events.
- **Should NOT contain:** ingestion writes as source-of-truth.

### `integrations/convex` + `integrations/postmark`
- **Responsibilities:** external adapter boundaries.
- **Public API:** `ConvexProjector::publish_*`, `PostmarkInboundMapper::map`.
- **Internal services:** retry/backoff, idempotency keying, serialization contracts.
- **Should NOT contain:** domain decisions.

## 4) Keep in Rust vs move out

### Keep in Rust
- Real-time ingestion normalization and deterministic classification pipeline.
- Tenant-aware routing and rule evaluation.
- Work + action execution state transitions (correctness-critical runtime core).
- Secrets handling and provider execution adapters.
- Domain event emission and low-latency orchestration.

### Move out of Rust (Convex / Next.js / external)
- **Convex**
  - UI-facing query models and dashboards.
  - Historical analytics materializations for product surfaces.
  - Admin metadata/document storage that is not execution-critical.
- **Next.js**
  - Tenant onboarding UX, admin/config editing, process/routing visualization.
  - Human-in-the-loop review screens and governance workflows.
- **External services**
  - Heavy asynchronous workflows (notifications, long-running automations, external ETL).
  - Non-critical BI/reporting pipelines.

## 5) Missing system primitives for scale

- **Domain event log/event bus** (current state is mutable vectors, not durable event streams).
- **Execution state machine** for ingress/work/action lifecycle with explicit transition guards.
- **Tenant isolation abstraction** (store partition + policy checks, not just `tenant_id` filtering).
- **Schema/contract registry** for webhook and integration payload versions.
- **Workflow engine boundary** for multi-step actions/escalations.
- **Idempotency primitives** for webhook replay and projection writes.
- **Observability hooks** (trace/span correlation, metrics per stage, failure taxonomy).
- **Simulation model abstraction** backed by event replay instead of direct shared state mutation.
- **Outbox/projection pipeline** for Convex writes with retry and exactly-once semantics.

## 6) Proposed target architecture + data flow

### Runtime flow
1. `api` receives signal/webhook request.
2. `ingestion` normalizes and emits `SignalReceived` domain event.
3. `classification` consumes signal, emits `SignalClassified` + `MeaningInferred`.
4. `routing` + `rules` produce route decision, emits `WorkRouted`.
5. `work` creates/updates work aggregate, emits `WorkCreated`/`ActionSelected`/`OutcomeRecorded`.
6. `actions` executes provider action and emits `ActionExecuted`.
7. `projections` update:
   - Convex read models
   - behavioral/process/artifact analytics
   - API query views

### Where Convex fits
- Primary projection/read-model layer consumed by Next.js.
- Receives domain-event-derived updates from Rust integration outbox.
- Not the source for deterministic runtime decisions.

### Where Next.js fits
- Operator/admin experience layer:
  - onboarding
  - tenant configuration
  - visualization/dashboards
  - manual review/action approval UI
- Calls Rust runtime APIs for command-side operations.
- Reads Convex for query-side operational views.

## 7) Concrete refactor sequence (minimal-risk path)

1. Extract `state`, domain structs, and pure helpers from `main.rs` into `domain/*`.
2. Move route handlers to `api/routes/*` and keep handlers thin.
3. Introduce application services (`IngestionService`, `WorkService`, `ExecutionService`) called by handlers.
4. Move Convex and Postmark code into `integrations/*` adapters.
5. Replace direct vector mutation flows with domain-event emission + projection updaters.
6. Add explicit lifecycle state machine + idempotency keys for ingress/work/action commands.
7. Split simulation and analytics into projection modules reading domain events.
