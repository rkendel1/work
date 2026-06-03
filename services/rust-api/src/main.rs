use actix_cors::Cors;
use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::{DateTime, Utc};
use rand::Rng;
use recommendation_engine::{
    ActionType, ClassificationResult, Entity as ClassificationEntity, RecommendationGenerator,
    RecommendedAction, RuleBasedRecommendationEngine,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

mod application;
mod config;
mod domain;
mod infrastructure;
mod recommendation_engine;
pub(crate) mod routes;
mod runtime_flow;
use config::Config;
use routes::app_config;

const SERVICE_NAME: &str = "rust-api";
const CONTRACT_VERSION: &str = "pr35";
const ROUTER_ACTIVE_MARKER: &str = "router=app_config::ACTIVE";

fn runtime_mode(convex_config: &ConvexConfig) -> &'static str {
    if convex_config.is_connected() {
        "connected"
    } else {
        "standalone"
    }
}

fn ok_envelope(data: Value, mode: &'static str) -> Value {
    serde_json::json!({
        "ok": true,
        "service": SERVICE_NAME,
        "trace_id": null,
        "data": data,
        "error": null,
        "meta": {
            "mode": mode,
            "version": CONTRACT_VERSION
        }
    })
}

fn error_envelope(code: &str, message: &str, recoverable: bool, mode: &'static str) -> Value {
    serde_json::json!({
        "ok": false,
        "service": SERVICE_NAME,
        "trace_id": null,
        "data": null,
        "error": {
            "code": code,
            "message": message,
            "recoverable": recoverable
        },
        "meta": {
            "mode": mode,
            "version": CONTRACT_VERSION
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboxItem {
    id: Uuid,
    tenant_id: String,
    source: String,
    received_at: DateTime<Utc>,
    content: String,
    status: String,
    status_updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IngressEvent {
    ingress_id: Uuid,
    tenant_id: String,
    event_type: String,
    description: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SignalEvent {
    id: Uuid,
    tenant_id: String,
    source_type: String,
    provenance: SignalProvenance,
    raw_payload: Value,
    normalized_content: String,
    metadata: SignalMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalProvenance {
    origin: String,
    generated_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SignalMetadata {
    sender: Option<String>,
    timestamp: i64,
    channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IngressTimelineEntry {
    #[serde(rename = "type")]
    entry_type: String,
    description: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkItem {
    id: Uuid,
    tenant_id: String,
    inbox_item_id: Uuid,
    classification_type: String,
    title: String,
    summary: String,
    priority: String,
    status: String,
    assigned_org_unit_id: Uuid,
    current_owner_id: Option<String>,
    routing_path: Vec<Uuid>,
    escalation_target: Option<String>,
    suppress_action: bool,
    require_approval: bool,
    applied_rules: Vec<AppliedBusinessRule>,
    recommended_actions: Vec<RecommendedAction>,
    operational_meaning: Option<OperationalMeaning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperationalMeaning {
    tenant_id: String,
    entity_type: String,
    entity_id: String,
    system_concept: String,
    inferred_meaning: String,
    state: String,
    confidence: f64,
    evidence: Vec<String>,
    crosswalk_version: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppliedBusinessRule {
    rule_id: Uuid,
    title: String,
    scope: String,
    effect_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActionSelection {
    id: Uuid,
    tenant_id: String,
    work_item_id: Uuid,
    system_action: String,
    tenant_action: String,
    selected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkOutcome {
    id: Uuid,
    tenant_id: String,
    work_item_id: Uuid,
    selected_action_id: Option<String>,
    status: String,
    resolution_notes: Option<String>,
    feedback: Option<String>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BehavioralPattern {
    id: Uuid,
    tenant_id: String,
    pattern_type: String,
    description: String,
    evidence: Value,
    confidence: f64,
    impact_score: f64,
    first_observed_at: i64,
    last_observed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessNode {
    id: Uuid,
    tenant_id: String,
    org_unit_id: Option<Uuid>,
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    source: String,
    confidence: f64,
    first_seen_at: i64,
    last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessEdge {
    id: Uuid,
    tenant_id: String,
    from_node_id: Uuid,
    to_node_id: Uuid,
    transition_type: String,
    frequency: f64,
    confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessGraph {
    tenant_id: String,
    process_name: String,
    process_nodes: Vec<ProcessNode>,
    process_edges: Vec<ProcessEdge>,
    designed_process: Vec<String>,
    drift_score: f64,
    bottlenecks: Vec<String>,
    bypass_paths: Vec<String>,
    external_execution_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperationalArtifact {
    tenant_id: String,
    name: String,
    #[serde(rename = "type")]
    artifact_type: String,
    org_unit_id: Option<Uuid>,
    source: String,
    version: u64,
    content: Value,
    derived_from: Vec<String>,
    last_updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IngestRequest {
    source: String,
    content: String,
    tenant_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalIngestRequest {
    source_type: Option<String>,
    provenance: Option<SignalProvenanceInput>,
    raw_payload: Option<Value>,
    normalized_content: Option<String>,
    metadata: Option<SignalMetadataInput>,
    tenant_id: Option<String>,
    idempotency_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalMetadataInput {
    sender: Option<String>,
    timestamp: Option<i64>,
    channel: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalProvenanceInput {
    origin: Option<String>,
    generated_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExtractRequest {
    inbox_item_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantScopedQuery {
    tenant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationalArtifactQuery {
    tenant_id: Option<String>,
    #[serde(rename = "type")]
    artifact_type: Option<String>,
    q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionQuery {
    tenant_id: Option<String>,
    classification_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PostmarkInboundRequest {
    from: Option<String>,
    from_full: Option<PostmarkAddress>,
    subject: Option<String>,
    text_body: Option<String>,
    html_body: Option<String>,
    message_id: Option<String>,
    idempotency_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PostmarkAddress {
    email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PostmarkWebhookResponse {
    inbox_item: InboxItem,
    work_item: WorkItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tenant {
    id: String,
    slug: String,
    domain: String,
    name: String,
    display_name: String,
    vertical: String,
    industry: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OrgUnit {
    id: Uuid,
    tenant_id: String,
    name: String,
    #[serde(rename = "type")]
    unit_type: String,
    parent_id: Option<Uuid>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActionDefinition {
    id: Uuid,
    tenant_id: String,
    name: String,
    description: String,
    category: String,
    classification_types: Vec<String>,
    assigned_org_unit_id: Uuid,
    default_owner_role: Option<String>,
    active: bool,
    execution_provider: String,
}

fn default_execution_provider() -> String {
    "internal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TenantSecret {
    id: Uuid,
    tenant_id: String,
    key_name: String,
    encrypted_value: String,
    provider: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExecutionSideEffect {
    #[serde(rename = "type")]
    side_effect_type: String,
    target_system: Option<String>,
    target_id: Option<String>,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExecutionResultRecord {
    id: Uuid,
    tenant_id: String,
    work_item_id: Uuid,
    action_id: Uuid,
    executed_by: String,
    execution_type: String,
    status: String,
    result_type: String,
    summary: String,
    side_effects: Vec<ExecutionSideEffect>,
    context_snapshot: Value,
    timestamp: i64,
    provider: String,
    external_ref: Option<String>,
    payload: Value,
    message: Option<String>,
    executed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BusinessRule {
    id: Uuid,
    tenant_id: String,
    org_unit_id: Option<Uuid>,
    title: String,
    rule_text: String,
    scope: String,
    active: bool,
    priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClassificationDefinition {
    tenant_id: String,
    #[serde(rename = "type")]
    classification_type: String,
    description: String,
}

#[derive(Debug, Clone)]
struct PackClassification {
    classification_type: &'static str,
    description: &'static str,
}

#[derive(Debug, Clone)]
struct PackAction {
    name: &'static str,
    description: &'static str,
    category: &'static str,
    classification_types: Vec<&'static str>,
}

#[derive(Debug, Clone)]
struct OperationalPack {
    vertical: &'static str,
    industry: &'static str,
    classifications: Vec<PackClassification>,
    actions: Vec<PackAction>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTenantRequest {
    name: Option<String>,
    tenant_name: Option<String>,
    slug: Option<String>,
    subdomain: Option<String>,
    vertical: Option<String>,
    industry: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateActionRequest {
    tenant_id: Option<String>,
    name: String,
    description: String,
    category: String,
    classification_types: Vec<String>,
    assigned_org_unit_id: Option<Uuid>,
    default_owner_role: Option<String>,
    active: Option<bool>,
    execution_provider: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOrgUnitRequest {
    tenant_id: Option<String>,
    name: String,
    #[serde(rename = "type")]
    unit_type: String,
    parent_id: Option<Uuid>,
    metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBusinessRuleRequest {
    tenant_id: Option<String>,
    org_unit_id: Option<Uuid>,
    title: String,
    rule_text: String,
    scope: String,
    active: Option<bool>,
    priority: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BusinessRulesQuery {
    tenant_id: Option<String>,
    org_unit_id: Option<Uuid>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutingPreviewQuery {
    tenant_id: Option<String>,
    classification_type: Option<String>,
    action_name: Option<String>,
    signal_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkRoutingPreview {
    tenant_id: String,
    classification_type: String,
    action_name: Option<String>,
    assigned_org_unit: Option<OrgUnit>,
    routing_path: Vec<OrgUnit>,
    priority: String,
    escalation_target: Option<String>,
    suppress_action: bool,
    require_approval: bool,
    applied_rules: Vec<AppliedBusinessRule>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectWorkActionRequest {
    system_action: String,
    tenant_action: Option<String>,
    selected_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordWorkOutcomeRequest {
    selected_action_id: Option<String>,
    status: String,
    resolution_notes: Option<String>,
    feedback: Option<String>,
    completed_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertTenantSecretRequest {
    tenant_id: Option<String>,
    key_name: String,
    value: String,
    provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteTenantSecretQuery {
    tenant_id: Option<String>,
    key_name: Option<String>,
    provider: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantSecretSummary {
    id: Uuid,
    tenant_id: String,
    key_name: String,
    provider: String,
    created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteActionRequest {
    tenant_id: Option<String>,
    work_item_id: Uuid,
    action_id: Option<Uuid>,
    action_name: Option<String>,
    provider: Option<String>,
    payload: Option<Value>,
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionListQuery {
    tenant_id: Option<String>,
    work_item_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
struct ExecutorOutcome {
    status: String,
    external_ref: Option<String>,
    message: Option<String>,
}

trait ActionExecutor {
    fn execute(
        &self,
        action: &ActionDefinition,
        work: &WorkItem,
        payload: &Value,
        secrets: &HashMap<String, String>,
    ) -> ExecutorOutcome;
}

struct DirectExecutor;
struct NangoExecutor;

struct State {
    signal_events: Vec<SignalEvent>,
    inbox_items: Vec<InboxItem>,
    ingress_events: Vec<IngressEvent>,
    work_items: Vec<WorkItem>,
    tenants: Vec<Tenant>,
    org_units: Vec<OrgUnit>,
    business_rules: Vec<BusinessRule>,
    actions: Vec<ActionDefinition>,
    classifications: Vec<ClassificationDefinition>,
    action_selections: Vec<ActionSelection>,
    work_outcomes: Vec<WorkOutcome>,
    execution_results: Vec<ExecutionResultRecord>,
    behavioral_patterns: Vec<BehavioralPattern>,
    process_nodes: Vec<ProcessNode>,
    process_edges: Vec<ProcessEdge>,
    operational_artifacts: Vec<OperationalArtifact>,
    tenant_secrets: Vec<TenantSecret>,
}

const DEFAULT_TENANT_ID: &str = "default";
const DEFAULT_TENANT_SLUG: &str = "default";
const DEFAULT_TENANT_NAME: &str = "Default Tenant";
const DEFAULT_TENANT_DOMAIN: &str = "www.canonflo.com";
const TENANT_BASE_DOMAIN: &str = "canonflo.com";

impl Default for State {
    fn default() -> Self {
        let default_tenant = Tenant {
            id: DEFAULT_TENANT_ID.to_string(),
            slug: DEFAULT_TENANT_SLUG.to_string(),
            domain: DEFAULT_TENANT_DOMAIN.to_string(),
            name: DEFAULT_TENANT_NAME.to_string(),
            display_name: DEFAULT_TENANT_NAME.to_string(),
            vertical: "Property Management".to_string(),
            industry: "Commercial Real Estate".to_string(),
            created_at: Utc::now().timestamp(),
        };
        let default_pack = load_pack("Property Management", "Commercial Real Estate");
        let org_units = org_units_from_pack(&default_tenant.id, &default_pack);
        let actions = actions_from_pack(&default_tenant.id, &default_pack, &org_units);
        let classifications = classifications_from_pack(&default_tenant.id, &default_pack);

        Self {
            signal_events: Vec::new(),
            inbox_items: Vec::new(),
            ingress_events: Vec::new(),
            work_items: Vec::new(),
            tenants: vec![default_tenant],
            org_units,
            business_rules: Vec::new(),
            actions,
            classifications,
            action_selections: Vec::new(),
            work_outcomes: Vec::new(),
            execution_results: Vec::new(),
            behavioral_patterns: Vec::new(),
            process_nodes: Vec::new(),
            process_edges: Vec::new(),
            operational_artifacts: Vec::new(),
            tenant_secrets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ConvexConfig {
    deployment_url: Option<String>,
    admin_key: Option<String>,
}

impl ConvexConfig {
    fn is_connected(&self) -> bool {
        self.deployment_url.is_some() && self.admin_key.is_some()
    }
}

pub(crate) struct AppState {
    state: Mutex<State>,
    convex_config: ConvexConfig,
    client: Client,
    vault_crypto: VaultCrypto,
    event_bus: domain::event_bus::EventBus,
}

impl AppState {
    pub(crate) fn new(convex_config: ConvexConfig) -> Self {
        Self {
            state: Mutex::new(State::default()),
            convex_config,
            client: Client::new(),
            vault_crypto: VaultCrypto::from_env(),
            event_bus: domain::event_bus::EventBus::new(),
        }
    }
}

#[derive(Clone)]
struct VaultCrypto {
    key: [u8; 32],
}

impl VaultCrypto {
    fn from_env() -> Self {
        if let Ok(raw_value) = std::env::var("VAULT_ENCRYPTION_KEY") {
            if let Ok(decoded) = BASE64_STANDARD.decode(raw_value.as_bytes())
                && decoded.len() == 32
            {
                let mut key = [0u8; 32];
                key.copy_from_slice(&decoded);
                return Self { key };
            }
        }

        let mut key = [0u8; 32];
        rand::rng().fill(&mut key);
        Self { key }
    }

    fn encrypt(&self, value: &str) -> Option<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).ok()?;
        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, value.as_bytes()).ok()?;
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        Some(BASE64_STANDARD.encode(combined))
    }

    fn decrypt(&self, encrypted_value: &str) -> Option<String> {
        let decoded = BASE64_STANDARD.decode(encrypted_value.as_bytes()).ok()?;
        if decoded.len() <= 12 {
            return None;
        }
        let (nonce_bytes, ciphertext) = decoded.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(&self.key).ok()?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;
        String::from_utf8(plaintext).ok()
    }
}

impl ActionExecutor for DirectExecutor {
    fn execute(
        &self,
        action: &ActionDefinition,
        work: &WorkItem,
        payload: &Value,
        secrets: &HashMap<String, String>,
    ) -> ExecutorOutcome {
        let provider = action.execution_provider.as_str();
        let required_secret = match provider {
            "slack" => Some("slack_bot_token"),
            "jira" => Some("jira_api_key"),
            "email" => Some("smtp_password"),
            "webhook" => Some("webhook_signing_secret"),
            _ => None,
        };

        if let Some(secret_name) = required_secret
            && !secrets.contains_key(secret_name)
        {
            return ExecutorOutcome {
                status: "failed".to_string(),
                external_ref: None,
                message: Some(format!("missing required secret `{secret_name}`")),
            };
        }

        let default_message = format!("Executed {} for work {}", action.name, work.id);
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or(default_message);

        ExecutorOutcome {
            status: "success".to_string(),
            external_ref: Some(format!("{provider}-{}", Uuid::new_v4())),
            message: Some(message),
        }
    }
}

impl ActionExecutor for NangoExecutor {
    fn execute(
        &self,
        action: &ActionDefinition,
        work: &WorkItem,
        payload: &Value,
        secrets: &HashMap<String, String>,
    ) -> ExecutorOutcome {
        if !secrets.contains_key("nango_connection_id") {
            return ExecutorOutcome {
                status: "failed".to_string(),
                external_ref: None,
                message: Some("missing required secret `nango_connection_id`".to_string()),
            };
        }

        let summary = payload
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("Nango execution completed");

        ExecutorOutcome {
            status: "success".to_string(),
            external_ref: Some(format!("nango-{}", Uuid::new_v4())),
            message: Some(format!("{summary}: {} for {}", action.name, work.id)),
        }
    }
}

fn lock_state(data: &web::Data<AppState>) -> MutexGuard<'_, State> {
    data.state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn contains_any(content: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| content.contains(keyword))
}

fn extract_entities(content: &str) -> Vec<ClassificationEntity> {
    let lower = content.to_lowercase();
    let mut entities = Vec::new();

    if lower.contains("hvac") {
        entities.push(ClassificationEntity {
            value: "HVAC".to_string(),
        });
    }
    if lower.contains("conference room a") {
        entities.push(ClassificationEntity {
            value: "Conference Room A".to_string(),
        });
    }

    entities
}

fn classify_content(content: &str) -> ClassificationResult {
    let lower = content.to_lowercase();

    if contains_any(
        &lower,
        &["hvac", "broken", "down", "not working", "repair", "issue"],
    ) {
        ClassificationResult {
            classification: "maintenance_request".to_string(),
            confidence: 0.93,
            priority: "medium".to_string(),
            reason: "Operational maintenance issue requiring inspection and follow-up.".to_string(),
            entities: extract_entities(content),
            recommendations: Vec::new(),
        }
    } else if contains_any(&lower, &["invoice", "payment", "billing", "dispute"]) {
        ClassificationResult {
            classification: "billing_inquiry".to_string(),
            confidence: 0.9,
            priority: "medium".to_string(),
            reason: "Billing or invoice review is needed before responding.".to_string(),
            entities: extract_entities(content),
            recommendations: Vec::new(),
        }
    } else if contains_any(&lower, &["schedule", "appointment"]) {
        ClassificationResult {
            classification: "scheduling_request".to_string(),
            confidence: 0.9,
            priority: "medium".to_string(),
            reason: "Scheduling-related request detected and ready for action.".to_string(),
            entities: extract_entities(content),
            recommendations: Vec::new(),
        }
    } else {
        ClassificationResult {
            classification: "operational_request".to_string(),
            confidence: 0.75,
            priority: "medium".to_string(),
            reason: "General operational request extracted from incoming information.".to_string(),
            entities: extract_entities(content),
            recommendations: Vec::new(),
        }
    }
}

fn classification_title(classification: &str) -> &'static str {
    match classification {
        "maintenance_request" => "Maintenance Request",
        "billing_inquiry" => "Billing Inquiry",
        "scheduling_request" => "Scheduling Request",
        _ => "Operational Request",
    }
}

fn infer_operational_meaning(
    tenant_id: &str,
    work_item_id: Uuid,
    classification: &str,
    summary: &str,
) -> OperationalMeaning {
    OperationalMeaning {
        tenant_id: tenant_id.to_string(),
        entity_type: "work_item".to_string(),
        entity_id: work_item_id.to_string(),
        system_concept: classification.to_string(),
        inferred_meaning: summary.to_string(),
        state: "inferred".to_string(),
        confidence: 0.5,
        evidence: vec![
            format!("classification:{classification}"),
            format!("summary:{summary}"),
        ],
        crosswalk_version: None,
        updated_at: Utc::now().timestamp(),
    }
}

fn normalize_identifier(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn resolve_tenant_id(tenant_id: Option<&str>) -> String {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TENANT_ID)
        .to_string()
}

fn resolve_idempotency_key(explicit_key: Option<&str>, fallback: String) -> String {
    explicit_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(fallback)
}

fn datetime_from_unix_timestamp(timestamp: i64) -> Option<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
}

fn is_valid_outcome_status(status: &str) -> bool {
    matches!(
        status,
        "completed" | "failed" | "escalated" | "duplicate" | "irrelevant"
    )
}

fn is_valid_feedback(feedback: &str) -> bool {
    matches!(feedback, "correct" | "wrong" | "partial" | "escalated")
}

fn is_valid_execution_status(status: &str) -> bool {
    matches!(
        status,
        "pending" | "running" | "success" | "partial" | "failed" | "pending_review"
    )
}

fn tenant_secret_summary(secret: &TenantSecret) -> TenantSecretSummary {
    TenantSecretSummary {
        id: secret.id,
        tenant_id: secret.tenant_id.clone(),
        key_name: secret.key_name.clone(),
        provider: secret.provider.clone(),
        created_at: secret.created_at.timestamp(),
    }
}

fn executor_for_provider(provider: &str) -> Box<dyn ActionExecutor + Send + Sync> {
    if provider.eq_ignore_ascii_case("nango") {
        Box::new(NangoExecutor)
    } else {
        Box::new(DirectExecutor)
    }
}

fn load_pack(vertical: &str, industry: &str) -> OperationalPack {
    if vertical.eq_ignore_ascii_case("Property Management")
        && industry.eq_ignore_ascii_case("Commercial Real Estate")
    {
        return OperationalPack {
            vertical: "Property Management",
            industry: "Commercial Real Estate",
            classifications: vec![
                PackClassification {
                    classification_type: "maintenance_request",
                    description: "Issue requiring onsite maintenance or repair.",
                },
                PackClassification {
                    classification_type: "tenant_complaint",
                    description: "Tenant complaint requiring operational response.",
                },
                PackClassification {
                    classification_type: "lease_question",
                    description: "Question related to lease terms or conditions.",
                },
                PackClassification {
                    classification_type: "access_request",
                    description: "Request for building or suite access.",
                },
                PackClassification {
                    classification_type: "vendor_coordination",
                    description: "Coordination request with external vendors.",
                },
            ],
            actions: vec![
                PackAction {
                    name: "Inspect HVAC Unit",
                    description: "Send technician to inspect HVAC equipment.",
                    category: "maintenance",
                    classification_types: vec!["maintenance_request"],
                },
                PackAction {
                    name: "Dispatch Maintenance Vendor",
                    description: "Coordinate approved vendor dispatch for maintenance.",
                    category: "maintenance",
                    classification_types: vec!["maintenance_request", "vendor_coordination"],
                },
                PackAction {
                    name: "Respond to Tenant",
                    description: "Provide tenant response and expected next steps.",
                    category: "response",
                    classification_types: vec!["tenant_complaint", "lease_question"],
                },
                PackAction {
                    name: "Schedule Inspection",
                    description: "Schedule onsite inspection with operations staff.",
                    category: "scheduling",
                    classification_types: vec!["maintenance_request", "access_request"],
                },
                PackAction {
                    name: "Create Work Order",
                    description: "Open a tracked work order for follow-up.",
                    category: "maintenance",
                    classification_types: vec!["tenant_complaint"],
                },
                PackAction {
                    name: "Escalate to Property Manager",
                    description: "Escalate high-priority case to property management.",
                    category: "escalation",
                    classification_types: vec!["tenant_complaint", "lease_question"],
                },
            ],
        };
    }

    if vertical.eq_ignore_ascii_case("Healthcare") && industry.eq_ignore_ascii_case("Clinic") {
        return OperationalPack {
            vertical: "Healthcare",
            industry: "Clinic",
            classifications: vec![
                PackClassification {
                    classification_type: "appointment_request",
                    description: "Patient request for scheduling or rescheduling.",
                },
                PackClassification {
                    classification_type: "patient_issue",
                    description: "Patient issue requiring clinical attention.",
                },
                PackClassification {
                    classification_type: "facility_issue",
                    description: "Facility issue requiring operational response.",
                },
                PackClassification {
                    classification_type: "billing_question",
                    description: "Billing or claims related inquiry.",
                },
            ],
            actions: vec![
                PackAction {
                    name: "Schedule Appointment",
                    description: "Schedule patient appointment with available slots.",
                    category: "scheduling",
                    classification_types: vec!["appointment_request", "scheduling_request"],
                },
                PackAction {
                    name: "Notify Clinical Staff",
                    description: "Notify clinical team about patient issue.",
                    category: "clinical",
                    classification_types: vec!["patient_issue"],
                },
                PackAction {
                    name: "Resolve Billing Inquiry",
                    description: "Resolve billing and claims inquiries.",
                    category: "billing",
                    classification_types: vec!["billing_question", "billing_inquiry"],
                },
                PackAction {
                    name: "Escalate to Provider",
                    description: "Escalate patient concern to provider.",
                    category: "escalation",
                    classification_types: vec!["patient_issue"],
                },
            ],
        };
    }

    OperationalPack {
        vertical: "Custom",
        industry: "General",
        classifications: vec![
            PackClassification {
                classification_type: "maintenance_request",
                description: "Issue requiring onsite maintenance or repair.",
            },
            PackClassification {
                classification_type: "billing_inquiry",
                description: "Billing inquiry requiring review.",
            },
            PackClassification {
                classification_type: "scheduling_request",
                description: "Scheduling request that needs operational follow-up.",
            },
            PackClassification {
                classification_type: "operational_request",
                description: "General operational request.",
            },
        ],
        actions: vec![
            PackAction {
                name: "Inspect HVAC Unit",
                description: "Send technician to inspect HVAC equipment.",
                category: "maintenance",
                classification_types: vec!["maintenance_request"],
            },
            PackAction {
                name: "Review Invoice",
                description: "Review invoice details and validate disputed line items.",
                category: "review",
                classification_types: vec!["billing_inquiry"],
            },
            PackAction {
                name: "Send Appointment Options",
                description: "Provide available appointment options and confirmation path.",
                category: "scheduling",
                classification_types: vec!["scheduling_request"],
            },
        ],
    }
}

fn pack_org_unit_templates(
    pack: &OperationalPack,
) -> Vec<(&'static str, &'static str, Option<&'static str>)> {
    if pack.vertical == "Property Management" && pack.industry == "Commercial Real Estate" {
        return vec![
            ("Operations", "department", None),
            ("Maintenance", "team", Some("Operations")),
            ("HVAC Team", "team", Some("Maintenance")),
            ("Plumbing Vendor", "vendor", Some("Maintenance")),
            ("Leasing", "team", Some("Operations")),
            ("Front Desk", "team", Some("Operations")),
        ];
    }

    if pack.vertical == "Healthcare" && pack.industry == "Clinic" {
        return vec![
            ("Clinic Operations", "department", None),
            ("Reception", "team", Some("Clinic Operations")),
            ("Clinical Staff", "team", Some("Clinic Operations")),
            ("Billing", "team", Some("Clinic Operations")),
            ("Compliance", "team", Some("Clinic Operations")),
        ];
    }

    vec![
        ("Operations", "department", None),
        ("General Team", "team", Some("Operations")),
    ]
}

fn pack_action_org_unit_name(pack: &OperationalPack, action_name: &str) -> &'static str {
    if pack.vertical == "Property Management" && pack.industry == "Commercial Real Estate" {
        return match action_name {
            "Inspect HVAC Unit" => "HVAC Team",
            "Dispatch Maintenance Vendor" => "Plumbing Vendor",
            "Respond to Tenant" => "Front Desk",
            "Schedule Inspection" => "Maintenance",
            "Create Work Order" => "Maintenance",
            "Escalate to Property Manager" => "Operations",
            _ => "Operations",
        };
    }

    if pack.vertical == "Healthcare" && pack.industry == "Clinic" {
        return match action_name {
            "Schedule Appointment" => "Reception",
            "Notify Clinical Staff" => "Clinical Staff",
            "Resolve Billing Inquiry" => "Billing",
            "Escalate to Provider" => "Clinical Staff",
            _ => "Clinic Operations",
        };
    }

    "General Team"
}

fn org_units_from_pack(tenant_id: &str, pack: &OperationalPack) -> Vec<OrgUnit> {
    let templates = pack_org_unit_templates(pack);
    let mut ids_by_name: HashMap<&str, Uuid> = HashMap::new();
    let mut units = Vec::new();

    for (name, unit_type, parent_name) in templates {
        let id = Uuid::new_v4();
        let parent_id = parent_name.and_then(|parent| ids_by_name.get(parent).copied());
        ids_by_name.insert(name, id);
        units.push(OrgUnit {
            id,
            tenant_id: tenant_id.to_string(),
            name: name.to_string(),
            unit_type: unit_type.to_string(),
            parent_id,
            metadata: None,
        });
    }

    units
}

fn tenant_primary_org_unit_id(state: &State, tenant_id: &str) -> Option<Uuid> {
    state
        .org_units
        .iter()
        .find(|unit| unit.tenant_id == tenant_id && unit.parent_id.is_none())
        .or_else(|| {
            state
                .org_units
                .iter()
                .find(|unit| unit.tenant_id == tenant_id)
        })
        .map(|unit| unit.id)
}

fn ensure_default_org_unit(state: &mut State, tenant_id: &str) -> Uuid {
    if let Some(existing_id) = tenant_primary_org_unit_id(state, tenant_id) {
        return existing_id;
    }

    let org_unit = OrgUnit {
        id: Uuid::new_v4(),
        tenant_id: tenant_id.to_string(),
        name: "Operations".to_string(),
        unit_type: "department".to_string(),
        parent_id: None,
        metadata: None,
    };
    let org_unit_id = org_unit.id;
    state.org_units.push(org_unit);
    org_unit_id
}

fn actions_from_pack(
    tenant_id: &str,
    pack: &OperationalPack,
    org_units: &[OrgUnit],
) -> Vec<ActionDefinition> {
    let fallback_org_unit_id = org_units
        .iter()
        .find(|unit| unit.parent_id.is_none())
        .or_else(|| org_units.first())
        .map(|unit| unit.id)
        .unwrap_or_else(Uuid::new_v4);

    pack.actions
        .iter()
        .map(|action| ActionDefinition {
            id: Uuid::new_v4(),
            tenant_id: tenant_id.to_string(),
            name: action.name.to_string(),
            description: action.description.to_string(),
            category: action.category.to_string(),
            classification_types: action
                .classification_types
                .iter()
                .map(|classification_type| classification_type.to_string())
                .collect(),
            assigned_org_unit_id: org_units
                .iter()
                .find(|unit| unit.name == pack_action_org_unit_name(pack, action.name))
                .map(|unit| unit.id)
                .unwrap_or(fallback_org_unit_id),
            default_owner_role: None,
            active: true,
            execution_provider: default_execution_provider(),
        })
        .collect()
}

fn classifications_from_pack(
    tenant_id: &str,
    pack: &OperationalPack,
) -> Vec<ClassificationDefinition> {
    pack.classifications
        .iter()
        .map(|classification| ClassificationDefinition {
            tenant_id: tenant_id.to_string(),
            classification_type: classification.classification_type.to_string(),
            description: classification.description.to_string(),
        })
        .collect()
}

fn onboarding_seed_signals(pack: &OperationalPack) -> Vec<&'static str> {
    if pack.vertical == "Property Management" && pack.industry == "Commercial Real Estate" {
        return vec![
            "HVAC failure reported in Unit 304. Tenant says no cooling since 8am.",
            "Vendor invoice mismatch for elevator maintenance contract. Charges do not match approved scope.",
            "Maintenance request backlog spike across building C. 14 tickets are now overdue.",
            "Elevator malfunction report from lobby. Intermittent shutdown during peak traffic.",
        ];
    }

    if pack.vertical == "Healthcare" && pack.industry == "Clinic" {
        return vec![
            "Patient intake complaint: appointment check-in queue exceeded 40 minutes.",
            "Billing discrepancy reported for outpatient visit claim line items.",
            "Facility alert: refrigeration unit temperature drift in medication storage.",
            "Provider schedule disruption caused follow-up appointment backlog.",
        ];
    }

    vec![
        "Urgent operations request received with unresolved ownership.",
        "Invoice review requested due to unexpected line-item variance.",
        "Service request aging beyond expected resolution window.",
        "Escalation notice: workflow delay impacting downstream teams.",
    ]
}

fn ensure_tenant_exists(state: &mut State, tenant_id: &str) {
    if state.tenants.iter().any(|tenant| tenant.id == tenant_id) {
        let _ = ensure_default_org_unit(state, tenant_id);
        return;
    }

    let tenant = Tenant {
        id: tenant_id.to_string(),
        slug: normalize_identifier(tenant_id),
        domain: format!("{}.{}", normalize_identifier(tenant_id), TENANT_BASE_DOMAIN),
        name: tenant_id.to_string(),
        display_name: tenant_id.to_string(),
        vertical: "General".to_string(),
        industry: "General".to_string(),
        created_at: Utc::now().timestamp(),
    };
    state.tenants.push(tenant);
    let _ = ensure_default_org_unit(state, tenant_id);
}

fn tenant_recommendations(
    state: &State,
    tenant_id: &str,
    classification_type: &str,
) -> Vec<RecommendedAction> {
    let tenant_actions: Vec<RecommendedAction> = state
        .actions
        .iter()
        .filter(|action| {
            action.tenant_id == tenant_id
                && action.active
                && action
                    .classification_types
                    .iter()
                    .any(|action_type| action_type == classification_type)
        })
        .map(|action| RecommendedAction {
            title: action.name.clone(),
            description: action.description.clone(),
            action_type: ActionType::from_category(&action.category),
        })
        .collect();

    if !tenant_actions.is_empty() {
        return tenant_actions;
    }

    let Some(tenant) = state.tenants.iter().find(|tenant| tenant.id == tenant_id) else {
        return tenant_actions;
    };

    let pack = load_pack(&tenant.vertical, &tenant.industry);
    let tenant_org_units: Vec<OrgUnit> = state
        .org_units
        .iter()
        .filter(|unit| unit.tenant_id == tenant_id)
        .cloned()
        .collect();
    actions_from_pack(tenant_id, &pack, &tenant_org_units)
        .iter()
        .filter(|action| {
            action
                .classification_types
                .iter()
                .any(|item| item == classification_type)
        })
        .map(|action| RecommendedAction {
            title: action.name.clone(),
            description: action.description.clone(),
            action_type: ActionType::from_category(&action.category),
        })
        .collect()
}

fn build_routing_path(state: &State, assigned_org_unit_id: Uuid) -> Vec<Uuid> {
    let mut path = Vec::new();
    let mut current = Some(assigned_org_unit_id);

    while let Some(org_unit_id) = current {
        path.push(org_unit_id);
        current = state
            .org_units
            .iter()
            .find(|unit| unit.id == org_unit_id)
            .and_then(|unit| unit.parent_id);
    }

    path.reverse();
    path
}

fn route_work_item(
    state: &mut State,
    tenant_id: &str,
    classification_type: &str,
    recommendations: &[RecommendedAction],
) -> (Uuid, Vec<Uuid>) {
    let route_from_state_action = |state: &State, action_name: &str| {
        state
            .actions
            .iter()
            .find(|action| {
                action.tenant_id == tenant_id && action.active && action.name == action_name
            })
            .map(|action| action.assigned_org_unit_id)
    };

    for recommendation in recommendations {
        if let Some(assigned_org_unit_id) = route_from_state_action(state, &recommendation.title) {
            return (
                assigned_org_unit_id,
                build_routing_path(state, assigned_org_unit_id),
            );
        }
    }

    if let Some(assigned_org_unit_id) = state
        .actions
        .iter()
        .find(|action| {
            action.tenant_id == tenant_id
                && action.active
                && action
                    .classification_types
                    .iter()
                    .any(|action_classification| action_classification == classification_type)
        })
        .map(|action| action.assigned_org_unit_id)
    {
        return (
            assigned_org_unit_id,
            build_routing_path(state, assigned_org_unit_id),
        );
    }

    let fallback_org_unit_id = ensure_default_org_unit(state, tenant_id);
    (
        fallback_org_unit_id,
        build_routing_path(state, fallback_org_unit_id),
    )
}

struct RuleEvaluationContext<'a> {
    content: &'a str,
    classification_type: &'a str,
    recommended_actions: &'a [RecommendedAction],
    assigned_org_unit_id: Uuid,
}

#[derive(Default)]
struct RuleEffect {
    override_priority: Option<String>,
    override_org_unit_id: Option<Uuid>,
    escalation_target: Option<String>,
    suppress_action: bool,
    require_approval: bool,
}

fn extract_rule_keywords(rule_text: &str) -> Vec<String> {
    let mut keywords = Vec::new();
    let mut active_quote: Option<char> = None;
    let mut current = String::new();
    for character in rule_text.chars() {
        if active_quote.is_none() && (character == '"' || character == '\'') {
            active_quote = Some(character);
            current.clear();
            continue;
        }
        if active_quote == Some(character) {
            let keyword = current.trim().to_lowercase();
            if !keyword.is_empty() {
                keywords.push(keyword);
            }
            active_quote = None;
            current.clear();
            continue;
        }
        if active_quote.is_some() {
            current.push(character);
        }
    }
    keywords
}

fn parse_priority_override(rule_text_lower: &str) -> Option<String> {
    if rule_text_lower.contains("priority = high") || rule_text_lower.contains("high priority") {
        return Some("high".to_string());
    }
    if rule_text_lower.contains("priority = low") || rule_text_lower.contains("low priority") {
        return Some("low".to_string());
    }
    if rule_text_lower.contains("priority = medium") || rule_text_lower.contains("medium priority")
    {
        return Some("medium".to_string());
    }
    None
}

fn evaluate_rule(
    rule_text: &str,
    context: &RuleEvaluationContext<'_>,
    state: &State,
) -> RuleEffect {
    let rule_text_lower = rule_text.to_lowercase();
    let content_lower = context.content.to_lowercase();
    let classification_lower = context.classification_type.to_lowercase();
    let recommendation_titles = context
        .recommended_actions
        .iter()
        .map(|action| action.title.to_lowercase())
        .collect::<Vec<String>>();

    let keywords = extract_rule_keywords(rule_text);
    if !keywords.is_empty()
        && !keywords.iter().any(|keyword| {
            content_lower.contains(keyword)
                || classification_lower.contains(keyword)
                || recommendation_titles
                    .iter()
                    .any(|title| title.contains(keyword))
        })
    {
        return RuleEffect::default();
    }

    let mut effect = RuleEffect {
        override_priority: parse_priority_override(&rule_text_lower),
        ..RuleEffect::default()
    };

    for org_unit in &state.org_units {
        let org_name_lower = org_unit.name.to_lowercase();
        if rule_text_lower.contains(&format!("escalate to {}", org_name_lower))
            || rule_text_lower.contains(&format!("escalate to the {}", org_name_lower))
        {
            effect.escalation_target = Some(org_unit.name.clone());
        }
        if (rule_text_lower.contains("route to")
            || rule_text_lower.contains("go to")
            || rule_text_lower.contains("assign to")
            || rule_text_lower.contains("override org unit ="))
            && rule_text_lower.contains(&org_name_lower)
        {
            effect.override_org_unit_id = Some(org_unit.id);
        }
        if rule_text_lower.contains("reviewed by")
            && rule_text_lower.contains(&org_name_lower)
            && context.assigned_org_unit_id != org_unit.id
        {
            effect.require_approval = true;
            effect.escalation_target = Some(org_unit.name.clone());
        }
    }

    if (rule_text_lower.contains("do not") || rule_text_lower.contains("don't"))
        && (rule_text_lower.contains("dispatch")
            || recommendation_titles
                .iter()
                .any(|title| title.contains("dispatch")))
    {
        effect.suppress_action = true;
    }
    if rule_text_lower.contains("require approval")
        || rule_text_lower.contains("must be reviewed")
        || rule_text_lower.contains("review before execution")
    {
        effect.require_approval = true;
    }

    effect
}

fn apply_business_rules(
    state: &State,
    tenant_id: &str,
    context: &RuleEvaluationContext<'_>,
) -> (
    Option<String>,
    Option<Uuid>,
    Option<String>,
    bool,
    bool,
    Vec<AppliedBusinessRule>,
) {
    let mut override_priority: Option<String> = None;
    let mut override_org_unit_id: Option<Uuid> = None;
    let mut escalation_target: Option<String> = None;
    let mut suppress_action = false;
    let mut require_approval = false;
    let mut applied_rules = Vec::new();

    let mut rules: Vec<BusinessRule> = state
        .business_rules
        .iter()
        .filter(|rule| {
            rule.tenant_id == tenant_id
                && rule.active
                && (rule.org_unit_id.is_none()
                    || rule.org_unit_id == Some(context.assigned_org_unit_id))
        })
        .cloned()
        .collect();
    rules.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then(left.id.cmp(&right.id))
    });

    for rule in rules {
        let effect = evaluate_rule(&rule.rule_text, context, state);
        let has_effect = effect.override_priority.is_some()
            || effect.override_org_unit_id.is_some()
            || effect.escalation_target.is_some()
            || effect.suppress_action
            || effect.require_approval;
        if !has_effect {
            continue;
        }
        if let Some(priority) = effect.override_priority {
            override_priority = Some(priority);
        }
        if let Some(org_unit_id) = effect.override_org_unit_id {
            override_org_unit_id = Some(org_unit_id);
        }
        if let Some(target) = effect.escalation_target {
            escalation_target = Some(target);
        }
        if effect.suppress_action {
            suppress_action = true;
        }
        if effect.require_approval {
            require_approval = true;
        }

        let mut effect_parts = Vec::new();
        if let Some(priority) = override_priority.as_deref() {
            effect_parts.push(format!("priority={priority}"));
        }
        if let Some(org_unit_id) = override_org_unit_id {
            if let Some(org_unit) = state.org_units.iter().find(|item| item.id == org_unit_id) {
                effect_parts.push(format!("org_unit={}", org_unit.name));
            }
        }
        if let Some(target) = escalation_target.as_deref() {
            effect_parts.push(format!("escalation={target}"));
        }
        if suppress_action {
            effect_parts.push("suppress_action=true".to_string());
        }
        if require_approval {
            effect_parts.push("require_approval=true".to_string());
        }

        applied_rules.push(AppliedBusinessRule {
            rule_id: rule.id,
            title: rule.title,
            scope: rule.scope,
            effect_summary: effect_parts.join(", "),
        });
    }

    (
        override_priority,
        override_org_unit_id,
        escalation_target,
        suppress_action,
        require_approval,
        applied_rules,
    )
}

fn trimmed_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_signal_content(raw_payload: &Value, fallback_content: Option<&str>) -> String {
    if let Some(content) = trimmed_non_empty(fallback_content) {
        return content;
    }

    let keys = ["content", "text", "message", "body", "description"];
    for key in keys {
        if let Some(value) = raw_payload.get(key).and_then(Value::as_str)
            && !value.trim().is_empty()
        {
            return value.trim().to_string();
        }
    }

    if let Some(value) = raw_payload.as_str()
        && !value.trim().is_empty()
    {
        return value.trim().to_string();
    }

    raw_payload.to_string()
}

fn create_signal_event(
    state: &mut State,
    tenant_id: String,
    source_type: String,
    provenance: SignalProvenance,
    raw_payload: Value,
    normalized_content: String,
    metadata: SignalMetadata,
) -> SignalEvent {
    let signal_event = SignalEvent {
        id: Uuid::new_v4(),
        tenant_id,
        source_type,
        provenance,
        raw_payload,
        normalized_content,
        metadata,
    };

    state.signal_events.push(signal_event.clone());
    signal_event
}

fn create_inbox_item(
    state: &mut State,
    tenant_id: String,
    source: String,
    content: String,
) -> InboxItem {
    let now = Utc::now();
    let item = InboxItem {
        id: Uuid::new_v4(),
        tenant_id,
        source,
        received_at: now,
        content,
        status: "received".to_string(),
        status_updated_at: now,
    };

    state.inbox_items.push(item.clone());
    create_ingress_event(
        state,
        item.id,
        item.tenant_id.clone(),
        "received".to_string(),
        format!("Received via {}", item.source),
    );
    item
}

fn default_signal_provenance(source_type: &str) -> SignalProvenance {
    match source_type {
        "simulation" => SignalProvenance {
            origin: "synthetic".to_string(),
            generated_by: "scenario_engine".to_string(),
        },
        "replay" => SignalProvenance {
            origin: "mixed".to_string(),
            generated_by: "system".to_string(),
        },
        "email" | "webhook" | "api" => SignalProvenance {
            origin: "real".to_string(),
            generated_by: "user".to_string(),
        },
        _ => SignalProvenance {
            origin: "real".to_string(),
            generated_by: "system".to_string(),
        },
    }
}

fn create_ingress_event(
    state: &mut State,
    ingress_id: Uuid,
    tenant_id: String,
    event_type: String,
    description: String,
) -> IngressEvent {
    let event = IngressEvent {
        ingress_id,
        tenant_id,
        event_type,
        description,
        created_at: Utc::now(),
    };

    state.ingress_events.push(event.clone());
    event
}

fn update_ingress_status(
    state: &mut State,
    inbox_item_id: Uuid,
    status: &str,
    description: String,
) -> Option<IngressEvent> {
    let new_status = status.to_string();
    let now = Utc::now();
    let inbox_item = state
        .inbox_items
        .iter_mut()
        .find(|item| item.id == inbox_item_id)?;
    let tenant_id = inbox_item.tenant_id.clone();

    inbox_item.status = new_status.clone();
    inbox_item.status_updated_at = now;
    let _ = inbox_item;

    Some(create_ingress_event(
        state,
        inbox_item_id,
        tenant_id,
        new_status,
        description,
    ))
}

fn create_work_item(state: &mut State, inbox_item: &InboxItem) -> WorkItem {
    let mut classification_result = classify_content(&inbox_item.content);
    classification_result.recommendations = tenant_recommendations(
        state,
        &inbox_item.tenant_id,
        &classification_result.classification,
    );
    if classification_result.recommendations.is_empty() {
        let recommendation_engine = RuleBasedRecommendationEngine;
        classification_result.recommendations =
            recommendation_engine.generate(&classification_result);
    }
    let (assigned_org_unit_id, routing_path) = route_work_item(
        state,
        &inbox_item.tenant_id,
        &classification_result.classification,
        &classification_result.recommendations,
    );
    let rule_context = RuleEvaluationContext {
        content: &inbox_item.content,
        classification_type: &classification_result.classification,
        recommended_actions: &classification_result.recommendations,
        assigned_org_unit_id,
    };
    let (
        priority_override,
        assigned_org_unit_override,
        escalation_target,
        suppress_action,
        require_approval,
        applied_rules,
    ) = apply_business_rules(state, &inbox_item.tenant_id, &rule_context);
    let final_assigned_org_unit_id = assigned_org_unit_override.unwrap_or(assigned_org_unit_id);
    let final_routing_path = if final_assigned_org_unit_id == assigned_org_unit_id {
        routing_path
    } else {
        build_routing_path(state, final_assigned_org_unit_id)
    };
    let work_item_id = Uuid::new_v4();
    let classification_type = classification_result.classification.clone();
    let title = classification_title(&classification_type).to_string();
    let summary = classification_result.reason.clone();
    let priority = priority_override.unwrap_or_else(|| "medium".to_string());
    let operational_meaning = Some(infer_operational_meaning(
        &inbox_item.tenant_id,
        work_item_id,
        &classification_type,
        &summary,
    ));

    let work_item = WorkItem {
        id: work_item_id,
        tenant_id: inbox_item.tenant_id.clone(),
        inbox_item_id: inbox_item.id,
        classification_type,
        title,
        summary,
        priority,
        status: "open".to_string(),
        assigned_org_unit_id: final_assigned_org_unit_id,
        current_owner_id: None,
        routing_path: final_routing_path,
        escalation_target,
        suppress_action,
        require_approval,
        applied_rules,
        recommended_actions: classification_result.recommendations.clone(),
        operational_meaning,
    };

    state.work_items.push(work_item.clone());
    work_item
}

fn build_postmark_content(payload: &PostmarkInboundRequest) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(subject) = payload
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(format!("Subject: {subject}"));
    }

    if let Some(text_body) = payload
        .text_body
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(text_body.to_string());
    } else if let Some(html_body) = payload
        .html_body
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(html_body.to_string());
    }

    if let Some(message_id) = payload
        .message_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        parts.push(format!("Postmark-Message-ID: {message_id}"));
    }

    if parts.is_empty() {
        "No email content provided".to_string()
    } else {
        parts.join("\n\n")
    }
}

fn postmark_source(payload: &PostmarkInboundRequest) -> String {
    let sender = payload
        .from_full
        .as_ref()
        .and_then(|from_full| from_full.email.as_deref())
        .or(payload.from.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown");

    format!("postmark:{sender}")
}

#[derive(Debug, Serialize)]
struct ConvexMutationRequest<T> {
    path: String,
    args: T,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexInboxArgs {
    tenant_id: String,
    external_id: String,
    source: String,
    received_at: String,
    content: String,
    status: String,
    status_updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexSignalEventArgs {
    tenant_id: String,
    source_type: String,
    provenance: ConvexSignalProvenanceArgs,
    raw_payload: Value,
    normalized_content: String,
    metadata: ConvexSignalMetadataArgs,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexSignalProvenanceArgs {
    origin: String,
    generated_by: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexSignalMetadataArgs {
    sender: Option<String>,
    timestamp: i64,
    channel: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexWorkArgs {
    tenant_id: String,
    external_id: String,
    inbox_external_id: String,
    classification_type: String,
    title: String,
    summary: String,
    status: String,
    assigned_org_unit_external_id: String,
    current_owner_id: Option<String>,
    routing_path_external_ids: Vec<String>,
    routing_action_name: Option<String>,
    recommended_actions: Vec<ConvexRecommendedAction>,
    operational_meaning: Option<ConvexOperationalMeaning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexRecommendedAction {
    title: String,
    description: String,
    action_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexOperationalMeaning {
    system_concept: String,
    inferred_meaning: String,
    state: String,
    confidence: f64,
    evidence: Vec<String>,
    crosswalk_version: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexIngressEventArgs {
    tenant_id: String,
    ingress_external_id: String,
    event_type: String,
    description: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexUpdateIngressStatusArgs {
    tenant_id: String,
    ingress_external_id: String,
    status: String,
    status_updated_at: i64,
    event_type: String,
    description: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexTenantArgs {
    id: String,
    name: String,
    slug: String,
    domain: String,
    display_name: String,
    vertical: String,
    industry: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexBootstrapTenantFromPackArgs {
    tenant_id: String,
    vertical: String,
    industry: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexActionSelectionArgs {
    tenant_id: String,
    work_item_external_id: String,
    system_action: String,
    tenant_action: String,
    selected_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexWorkOutcomeArgs {
    tenant_id: String,
    work_item_external_id: String,
    selected_action_id: Option<String>,
    status: String,
    resolution_notes: Option<String>,
    feedback: Option<String>,
    completed_at: Option<i64>,
}

async fn send_convex_mutation<T: Serialize>(
    client: &Client,
    convex_config: &ConvexConfig,
    function_path: &str,
    args: T,
) -> Result<(), String> {
    let Some(deployment_url) = convex_config.deployment_url.as_deref() else {
        return Ok(());
    };

    let Some(admin_key) = convex_config.admin_key.as_deref() else {
        return Ok(());
    };

    let endpoint = format!("{}/api/mutation", deployment_url.trim_end_matches('/'));
    let payload = ConvexMutationRequest {
        path: function_path.to_string(),
        args,
    };

    let response = client
        .post(endpoint)
        .header("Authorization", format!("Convex {admin_key}"))
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unable to read response body".to_string());
        Err(format!("convex returned {status}: {body}"))
    }
}

async fn forward_inbox_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    inbox_item: &InboxItem,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:ingestInboxItem",
        ConvexInboxArgs {
            tenant_id: inbox_item.tenant_id.clone(),
            external_id: inbox_item.id.to_string(),
            source: inbox_item.source.clone(),
            received_at: inbox_item.received_at.to_rfc3339(),
            content: inbox_item.content.clone(),
            status: inbox_item.status.clone(),
            status_updated_at: inbox_item.status_updated_at.timestamp(),
        },
    )
    .await
}

async fn forward_signal_event_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    signal_event: &SignalEvent,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:createSignalEvent",
        ConvexSignalEventArgs {
            tenant_id: signal_event.tenant_id.clone(),
            source_type: signal_event.source_type.clone(),
            provenance: ConvexSignalProvenanceArgs {
                origin: signal_event.provenance.origin.clone(),
                generated_by: signal_event.provenance.generated_by.clone(),
            },
            raw_payload: signal_event.raw_payload.clone(),
            normalized_content: signal_event.normalized_content.clone(),
            metadata: ConvexSignalMetadataArgs {
                sender: signal_event.metadata.sender.clone(),
                timestamp: signal_event.metadata.timestamp,
                channel: signal_event.metadata.channel.clone(),
            },
        },
    )
    .await
}

async fn forward_work_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    work_item: &WorkItem,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:createWorkItem",
        ConvexWorkArgs {
            tenant_id: work_item.tenant_id.clone(),
            external_id: work_item.id.to_string(),
            inbox_external_id: work_item.inbox_item_id.to_string(),
            classification_type: work_item.classification_type.clone(),
            title: work_item.title.clone(),
            summary: work_item.summary.clone(),
            status: work_item.status.clone(),
            assigned_org_unit_external_id: work_item.assigned_org_unit_id.to_string(),
            current_owner_id: work_item.current_owner_id.clone(),
            routing_path_external_ids: work_item.routing_path.iter().map(Uuid::to_string).collect(),
            routing_action_name: work_item
                .recommended_actions
                .first()
                .map(|action| action.title.clone()),
            recommended_actions: work_item
                .recommended_actions
                .iter()
                .map(|action| ConvexRecommendedAction {
                    title: action.title.clone(),
                    description: action.description.clone(),
                    action_type: action.action_type.as_str().to_string(),
                })
                .collect(),
            operational_meaning: work_item.operational_meaning.as_ref().map(|meaning| {
                ConvexOperationalMeaning {
                    system_concept: meaning.system_concept.clone(),
                    inferred_meaning: meaning.inferred_meaning.clone(),
                    state: meaning.state.clone(),
                    confidence: meaning.confidence,
                    evidence: meaning.evidence.clone(),
                    crosswalk_version: meaning.crosswalk_version.clone(),
                    updated_at: meaning.updated_at,
                }
            }),
        },
    )
    .await
}

async fn forward_ingress_event_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    inbox_item_id: Uuid,
    event: &IngressEvent,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:createIngressEvent",
        ConvexIngressEventArgs {
            tenant_id: event.tenant_id.clone(),
            ingress_external_id: inbox_item_id.to_string(),
            event_type: event.event_type.clone(),
            description: event.description.clone(),
            created_at: event.created_at.timestamp(),
        },
    )
    .await
}

async fn forward_status_update_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    inbox_item_id: Uuid,
    event: &IngressEvent,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:updateIngressStatus",
        ConvexUpdateIngressStatusArgs {
            tenant_id: event.tenant_id.clone(),
            ingress_external_id: inbox_item_id.to_string(),
            status: event.event_type.clone(),
            status_updated_at: event.created_at.timestamp(),
            event_type: event.event_type.clone(),
            description: event.description.clone(),
            created_at: event.created_at.timestamp(),
        },
    )
    .await
}

async fn forward_action_selection_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    selection: &ActionSelection,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:recordActionSelection",
        ConvexActionSelectionArgs {
            tenant_id: selection.tenant_id.clone(),
            work_item_external_id: selection.work_item_id.to_string(),
            system_action: selection.system_action.clone(),
            tenant_action: selection.tenant_action.clone(),
            selected_at: selection.selected_at.timestamp(),
        },
    )
    .await
}

async fn forward_work_outcome_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    outcome: &WorkOutcome,
) -> Result<(), String> {
    send_convex_mutation(
        client,
        convex_config,
        "inbox:recordWorkOutcome",
        ConvexWorkOutcomeArgs {
            tenant_id: outcome.tenant_id.clone(),
            work_item_external_id: outcome.work_item_id.to_string(),
            selected_action_id: outcome.selected_action_id.clone(),
            status: outcome.status.clone(),
            resolution_notes: outcome.resolution_notes.clone(),
            feedback: outcome.feedback.clone(),
            completed_at: outcome
                .completed_at
                .map(|completed_at| completed_at.timestamp()),
        },
    )
    .await
}

async fn forward_tenant_bootstrap_to_convex(
    client: &Client,
    convex_config: &ConvexConfig,
    tenant: &Tenant,
) {
    if let Err(error) = send_convex_mutation(
        client,
        convex_config,
        "actions:createTenant",
        ConvexTenantArgs {
            id: tenant.id.clone(),
            name: tenant.name.clone(),
            slug: tenant.slug.clone(),
            domain: tenant.domain.clone(),
            display_name: tenant.display_name.clone(),
            vertical: tenant.vertical.clone(),
            industry: tenant.industry.clone(),
            created_at: tenant.created_at,
        },
    )
    .await
    {
        eprintln!("failed to seed tenant in convex: {error}");
    }

    if let Err(error) = send_convex_mutation(
        client,
        convex_config,
        "actions:bootstrapTenantFromPack",
        ConvexBootstrapTenantFromPackArgs {
            tenant_id: tenant.id.clone(),
            vertical: tenant.vertical.clone(),
            industry: tenant.industry.clone(),
        },
    )
    .await
    {
        eprintln!("failed to bootstrap tenant pack in convex: {error}");
    }
}

async fn ingest(data: web::Data<AppState>, payload: web::Bytes) -> impl Responder {
    let request = match serde_json::from_slice::<IngestRequest>(&payload) {
        Ok(request) => request,
        Err(_) => {
            return HttpResponse::BadRequest().json(error_envelope(
                "INVALID_INGEST_PAYLOAD",
                "Invalid ingest payload",
                true,
                runtime_mode(&data.convex_config),
            ));
        }
    };

    let ingestion_service = application::ingestion_service::IngestionService::new(data.clone());
    let item = ingestion_service.ingest_raw(request).await;
    HttpResponse::Created().json(item)
}

async fn ingest_signal(
    data: web::Data<AppState>,
    request: web::Json<SignalIngestRequest>,
) -> impl Responder {
    let source_type = request
        .source_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("api")
        .to_string();
    let raw_payload = request
        .raw_payload
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    let normalized_content =
        normalize_signal_content(&raw_payload, request.normalized_content.as_deref());
    if normalized_content.trim().is_empty() {
        return HttpResponse::BadRequest()
            .body("normalizedContent or rawPayload with text is required");
    }
    let metadata_timestamp = request
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.timestamp)
        .unwrap_or_else(|| Utc::now().timestamp());
    let provenance_defaults = default_signal_provenance(&source_type);
    let provenance = SignalProvenance {
        origin: request
            .provenance
            .as_ref()
            .and_then(|input| input.origin.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or(provenance_defaults.origin),
        generated_by: request
            .provenance
            .as_ref()
            .and_then(|input| input.generated_by.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or(provenance_defaults.generated_by),
    };
    let metadata = SignalMetadata {
        sender: request
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.sender.clone()),
        timestamp: metadata_timestamp,
        channel: request
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.channel.clone()),
    };
    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let idempotency_key = resolve_idempotency_key(
        request.idempotency_key.as_deref(),
        format!(
            "{tenant_id}:{source_type}:{normalized_content}:{}",
            raw_payload
        ),
    );
    if let Some(existing) = data
        .event_bus
        .get_idempotency("ingest_signal", &idempotency_key)
        .and_then(|value| serde_json::from_value::<InboxItem>(value).ok())
    {
        return HttpResponse::Ok().json(existing);
    }

    let (signal_event, inbox_item, received_event, published_event_ids) = {
        let mut state = lock_state(&data);
        ensure_tenant_exists(&mut state, &tenant_id);
        let flow = runtime_flow::ingest_signal_to_inbox(
            &mut state,
            &data.event_bus,
            runtime_flow::SignalIngestionInput {
                tenant_id,
                source_type: source_type.clone(),
                inbox_source: None,
                provenance,
                raw_payload,
                normalized_content,
                metadata,
            },
        );
        (
            flow.signal_event,
            flow.inbox_item,
            flow.received_event,
            flow.published_event_ids,
        )
    };

    let mut projection_error = None;
    if let Err(error) =
        forward_signal_event_to_convex(&data.client, &data.convex_config, &signal_event).await
    {
        eprintln!("failed to forward signal event to convex: {error}");
        projection_error = Some(error.to_string());
    }
    if let Err(error) =
        forward_inbox_to_convex(&data.client, &data.convex_config, &inbox_item).await
    {
        eprintln!("failed to forward inbox item to convex: {error}");
        projection_error = Some(error.to_string());
    }
    if let Some(event) = received_event {
        if let Err(error) = forward_ingress_event_to_convex(
            &data.client,
            &data.convex_config,
            inbox_item.id,
            &event,
        )
        .await
        {
            eprintln!("failed to forward ingress event to convex: {error}");
            projection_error = Some(error.to_string());
        }
    }
    if let Some(error) = projection_error {
        for event_id in &published_event_ids {
            data.event_bus
                .mark_projection_failure(event_id, error.clone());
        }
    } else {
        for event_id in &published_event_ids {
            data.event_bus.mark_projection_success(event_id);
        }
    }
    data.event_bus.put_idempotency(
        "ingest_signal",
        &idempotency_key,
        serde_json::to_value(&inbox_item).unwrap_or_else(|_| serde_json::json!({})),
    );

    HttpResponse::Created().json(inbox_item)
}

async fn extract(data: web::Data<AppState>, request: web::Json<ExtractRequest>) -> impl Responder {
    let (work_item, is_new, status_updates, recommendation_events, published_event_ids) = {
        let mut state = lock_state(&data);
        match runtime_flow::extract_work_from_inbox(
            &mut state,
            &data.event_bus,
            request.inbox_item_id,
        ) {
            Ok(flow) => (
                flow.work_item,
                flow.is_new,
                flow.status_updates,
                flow.recommendation_events,
                flow.published_event_ids,
            ),
            Err(runtime_flow::WorkExtractionError::InboxItemNotFound) => {
                return HttpResponse::NotFound().body("inbox item not found");
            }
        }
    };

    if is_new {
        let mut projection_error = None;
        if let Err(error) =
            forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
        {
            eprintln!("failed to forward work item to convex: {error}");
            projection_error = Some(error.to_string());
        }
        for (inbox_item_id, event) in &status_updates {
            if let Err(error) = forward_status_update_to_convex(
                &data.client,
                &data.convex_config,
                *inbox_item_id,
                event,
            )
            .await
            {
                eprintln!("failed to forward ingress status update to convex: {error}");
                projection_error = Some(error.to_string());
            }
        }
        for (inbox_item_id, event) in &recommendation_events {
            if let Err(error) = forward_ingress_event_to_convex(
                &data.client,
                &data.convex_config,
                *inbox_item_id,
                event,
            )
            .await
            {
                eprintln!("failed to forward recommendation event to convex: {error}");
                projection_error = Some(error.to_string());
            }
        }
        if let Some(error) = projection_error {
            for event_id in &published_event_ids {
                data.event_bus
                    .mark_projection_failure(event_id, error.clone());
            }
        } else {
            for event_id in &published_event_ids {
                data.event_bus.mark_projection_success(event_id);
            }
        }
        HttpResponse::Created().json(work_item)
    } else {
        HttpResponse::Ok().json(work_item)
    }
}

async fn postmark_inbound(
    data: web::Data<AppState>,
    payload: web::Json<PostmarkInboundRequest>,
) -> impl Responder {
    let raw_payload = match serde_json::to_value(&*payload) {
        Ok(value) => value,
        Err(_) => serde_json::json!({}),
    };
    let content = build_postmark_content(&payload);
    let source = postmark_source(&payload);
    let sender = payload
        .from_full
        .as_ref()
        .and_then(|from_full| from_full.email.clone())
        .or_else(|| payload.from.clone());
    let idempotency_key = resolve_idempotency_key(
        payload
            .idempotency_key
            .as_deref()
            .or(payload.message_id.as_deref()),
        format!("postmark:{source}:{content}"),
    );
    if let Some(existing) = data
        .event_bus
        .get_idempotency("postmark_inbound", &idempotency_key)
        .and_then(|value| serde_json::from_value::<PostmarkWebhookResponse>(value).ok())
    {
        return HttpResponse::Ok().json(existing);
    }

    let (
        signal_event,
        inbox_item,
        work_item,
        status_updates,
        received_event,
        recommendations_event,
        ingestion_published_event_ids,
        extraction_published_event_ids,
    ) = {
        let mut state = lock_state(&data);
        let tenant_id = DEFAULT_TENANT_ID.to_string();
        ensure_tenant_exists(&mut state, &tenant_id);
        let flow = runtime_flow::ingest_signal_to_inbox(
            &mut state,
            &data.event_bus,
            runtime_flow::SignalIngestionInput {
                tenant_id,
                source_type: "email".to_string(),
                inbox_source: Some(source),
                provenance: default_signal_provenance("email"),
                raw_payload,
                normalized_content: content,
                metadata: SignalMetadata {
                    sender,
                    timestamp: Utc::now().timestamp(),
                    channel: Some("postmark".to_string()),
                },
            },
        );
        let signal_event = flow.signal_event;
        let inbox_item = flow.inbox_item;
        let received_event = flow.received_event;
        let ingestion_published_event_ids = flow.published_event_ids;
        let work_flow =
            runtime_flow::extract_work_from_inbox(&mut state, &data.event_bus, inbox_item.id)
                .expect("work extraction should succeed for newly ingested inbox item");
        let work_item = work_flow.work_item;
        let status_updates = work_flow.status_updates;
        let recommendations_event = work_flow.recommendation_events[0].1.clone();
        let extraction_published_event_ids = work_flow.published_event_ids;
        (
            signal_event,
            inbox_item,
            work_item,
            status_updates,
            received_event,
            recommendations_event,
            ingestion_published_event_ids,
            extraction_published_event_ids,
        )
    };

    let mut projection_error = None;
    if let Err(error) =
        forward_signal_event_to_convex(&data.client, &data.convex_config, &signal_event).await
    {
        eprintln!("failed to forward postmark signal event to convex: {error}");
        projection_error = Some(error.to_string());
    }
    if let Err(error) =
        forward_inbox_to_convex(&data.client, &data.convex_config, &inbox_item).await
    {
        eprintln!("failed to forward postmark inbox item to convex: {error}");
        projection_error = Some(error.to_string());
    }
    if let Some(event) = received_event {
        if let Err(error) = forward_ingress_event_to_convex(
            &data.client,
            &data.convex_config,
            inbox_item.id,
            &event,
        )
        .await
        {
            eprintln!("failed to forward postmark ingress event to convex: {error}");
            projection_error = Some(error.to_string());
        }
    }
    if let Err(error) = forward_ingress_event_to_convex(
        &data.client,
        &data.convex_config,
        inbox_item.id,
        &recommendations_event,
    )
    .await
    {
        eprintln!("failed to forward postmark recommendation event to convex: {error}");
        projection_error = Some(error.to_string());
    }

    if let Err(error) = forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
    {
        eprintln!("failed to forward postmark work item to convex: {error}");
        projection_error = Some(error.to_string());
    }
    for (inbox_item_id, event) in &status_updates {
        if let Err(error) = forward_status_update_to_convex(
            &data.client,
            &data.convex_config,
            *inbox_item_id,
            event,
        )
        .await
        {
            eprintln!("failed to forward postmark ingress status update to convex: {error}");
            projection_error = Some(error.to_string());
        }
    }
    let mut published_event_ids = ingestion_published_event_ids;
    published_event_ids.extend(extraction_published_event_ids);
    if let Some(error) = projection_error {
        for event_id in &published_event_ids {
            data.event_bus
                .mark_projection_failure(event_id, error.clone());
        }
    } else {
        for event_id in &published_event_ids {
            data.event_bus.mark_projection_success(event_id);
        }
    }

    let response = PostmarkWebhookResponse {
        inbox_item,
        work_item,
    };
    data.event_bus.put_idempotency(
        "postmark_inbound",
        &idempotency_key,
        serde_json::to_value(&response).unwrap_or_else(|_| serde_json::json!({})),
    );

    HttpResponse::Created().json(response)
}

async fn create_tenant(
    data: web::Data<AppState>,
    request: web::Json<CreateTenantRequest>,
) -> impl Responder {
    let name = request
        .tenant_name
        .as_deref()
        .or(request.name.as_deref())
        .unwrap_or("")
        .trim();
    let vertical = request
        .vertical
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("General");
    let industry = request
        .industry
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("General");
    if name.is_empty() {
        return HttpResponse::BadRequest().body("tenantName or name is required");
    }

    let mut state = lock_state(&data);
    let requested_subdomain = request.slug.as_deref().or(request.subdomain.as_deref());
    if requested_subdomain
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return HttpResponse::BadRequest().body("subdomain or slug is required");
    }
    let mut slug = requested_subdomain
        .map(normalize_identifier)
        .unwrap_or_default();
    if slug.is_empty() {
        return HttpResponse::BadRequest().body("subdomain or slug is required");
    }
    if state.tenants.iter().any(|tenant| tenant.slug == slug) {
        slug = format!("{slug}-{}", Uuid::new_v4().simple());
    }
    let mut id = slug.clone();
    if state.tenants.iter().any(|tenant| tenant.id == id) {
        id = format!("{id}_{}", Uuid::new_v4().simple());
    }
    let created_at = Utc::now().timestamp();
    let domain = format!("{slug}.{TENANT_BASE_DOMAIN}");

    let pack = load_pack(vertical, industry);
    let tenant = Tenant {
        id: id.clone(),
        slug: slug.clone(),
        domain,
        name: name.to_string(),
        display_name: name.to_string(),
        vertical: pack.vertical.to_string(),
        industry: pack.industry.to_string(),
        created_at,
    };
    let org_units = org_units_from_pack(&id, &pack);
    state.tenants.push(tenant.clone());
    state.org_units.extend(org_units.clone());
    state
        .actions
        .extend(actions_from_pack(&id, &pack, &org_units));
    state
        .classifications
        .extend(classifications_from_pack(&id, &pack));
    let mut onboarding_seed = Vec::new();
    for content in onboarding_seed_signals(&pack) {
        let now = Utc::now().timestamp();
        let signal_event = create_signal_event(
            &mut state,
            id.clone(),
            "simulation".to_string(),
            default_signal_provenance("simulation"),
            serde_json::json!({
                "source": "simulation",
                "content": content,
                "scenario": "onboarding"
            }),
            content.to_string(),
            SignalMetadata {
                sender: Some("canonflo-sim@system.canonflo.com".to_string()),
                timestamp: now,
                channel: Some("simulation".to_string()),
            },
        );
        let inbox_item = create_inbox_item(
            &mut state,
            id.clone(),
            "simulation".to_string(),
            content.to_string(),
        );
        let received_event = state
            .ingress_events
            .iter()
            .find(|event| event.ingress_id == inbox_item.id && event.event_type == "received")
            .cloned();
        let work_item = create_work_item(&mut state, &inbox_item);
        let classified_event = update_ingress_status(
            &mut state,
            inbox_item.id,
            "classified",
            format!("Classification: {}", work_item.title),
        );
        let recommendations_event = create_ingress_event(
            &mut state,
            inbox_item.id,
            inbox_item.tenant_id.clone(),
            "recommendations_generated".to_string(),
            format!(
                "Generated {} recommended actions",
                work_item.recommended_actions.len()
            ),
        );
        let work_generated_event = update_ingress_status(
            &mut state,
            inbox_item.id,
            "work_generated",
            format!("Created Work Item {}", work_item.id),
        );
        onboarding_seed.push((
            signal_event,
            inbox_item,
            work_item,
            received_event,
            classified_event,
            recommendations_event,
            work_generated_event,
        ));
    }
    drop(state);

    forward_tenant_bootstrap_to_convex(&data.client, &data.convex_config, &tenant).await;
    for (
        signal_event,
        inbox_item,
        work_item,
        received_event,
        classified_event,
        recommendations_event,
        work_generated_event,
    ) in onboarding_seed
    {
        if let Err(error) =
            forward_signal_event_to_convex(&data.client, &data.convex_config, &signal_event).await
        {
            eprintln!("failed to forward onboarding signal event to convex: {error}");
        }
        if let Err(error) =
            forward_inbox_to_convex(&data.client, &data.convex_config, &inbox_item).await
        {
            eprintln!("failed to forward onboarding inbox item to convex: {error}");
        }
        if let Some(event) = received_event
            && let Err(error) = forward_ingress_event_to_convex(
                &data.client,
                &data.convex_config,
                inbox_item.id,
                &event,
            )
            .await
        {
            eprintln!("failed to forward onboarding ingress event to convex: {error}");
        }
        if let Err(error) =
            forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
        {
            eprintln!("failed to forward onboarding work item to convex: {error}");
        }
        if let Some(event) = classified_event
            && let Err(error) = forward_status_update_to_convex(
                &data.client,
                &data.convex_config,
                inbox_item.id,
                &event,
            )
            .await
        {
            eprintln!("failed to forward onboarding classified status to convex: {error}");
        }
        if let Err(error) = forward_ingress_event_to_convex(
            &data.client,
            &data.convex_config,
            inbox_item.id,
            &recommendations_event,
        )
        .await
        {
            eprintln!("failed to forward onboarding recommendations to convex: {error}");
        }
        if let Some(event) = work_generated_event
            && let Err(error) = forward_status_update_to_convex(
                &data.client,
                &data.convex_config,
                inbox_item.id,
                &event,
            )
            .await
        {
            eprintln!("failed to forward onboarding work-generated status to convex: {error}");
        }
    }
    HttpResponse::Created().json(tenant)
}

async fn list_tenants(data: web::Data<AppState>) -> impl Responder {
    let tenant_service = application::tenant_service::TenantService::new(data);
    HttpResponse::Ok().json(tenant_service.list_tenants())
}

async fn list_org_units(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let state = lock_state(&data);
    let org_units: Vec<OrgUnit> = state
        .org_units
        .iter()
        .filter(|org_unit| org_unit.tenant_id == tenant_id)
        .cloned()
        .collect();
    HttpResponse::Ok().json(org_units)
}

async fn create_org_unit(
    data: web::Data<AppState>,
    request: web::Json<CreateOrgUnitRequest>,
) -> impl Responder {
    if request.name.trim().is_empty() || request.unit_type.trim().is_empty() {
        return HttpResponse::BadRequest().body("name and type are required");
    }

    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let mut state = lock_state(&data);
    ensure_tenant_exists(&mut state, &tenant_id);

    if let Some(parent_id) = request.parent_id
        && !state
            .org_units
            .iter()
            .any(|org_unit| org_unit.id == parent_id && org_unit.tenant_id == tenant_id)
    {
        return HttpResponse::BadRequest().body("parentId is invalid for tenant");
    }

    let org_unit = OrgUnit {
        id: Uuid::new_v4(),
        tenant_id,
        name: request.name.trim().to_string(),
        unit_type: request.unit_type.trim().to_lowercase(),
        parent_id: request.parent_id,
        metadata: request.metadata.clone(),
    };
    state.org_units.push(org_unit.clone());
    HttpResponse::Created().json(org_unit)
}

async fn list_business_rules(
    data: web::Data<AppState>,
    query: web::Query<BusinessRulesQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let scope_filter = query
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let state = lock_state(&data);
    let mut rules: Vec<BusinessRule> = state
        .business_rules
        .iter()
        .filter(|rule| rule.tenant_id == tenant_id)
        .filter(|rule| {
            if let Some(scope) = &scope_filter {
                rule.scope == *scope
            } else {
                true
            }
        })
        .filter(|rule| {
            if let Some(org_unit_id) = query.org_unit_id {
                rule.org_unit_id == Some(org_unit_id)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    rules.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then(left.id.cmp(&right.id))
    });
    HttpResponse::Ok().json(rules)
}

async fn create_business_rule(
    data: web::Data<AppState>,
    request: web::Json<CreateBusinessRuleRequest>,
) -> impl Responder {
    let title = request.title.trim();
    let rule_text = request.rule_text.trim();
    let scope = request.scope.trim().to_lowercase();
    if title.is_empty() || rule_text.is_empty() || scope.is_empty() {
        return HttpResponse::BadRequest().body("title, ruleText, and scope are required");
    }
    if !matches!(
        scope.as_str(),
        "routing" | "priority" | "escalation" | "execution" | "classification_override"
    ) {
        return HttpResponse::BadRequest()
            .body("scope must be one of routing, priority, escalation, execution, classification_override");
    }

    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let mut state = lock_state(&data);
    ensure_tenant_exists(&mut state, &tenant_id);
    if let Some(org_unit_id) = request.org_unit_id
        && !state
            .org_units
            .iter()
            .any(|org_unit| org_unit.id == org_unit_id && org_unit.tenant_id == tenant_id)
    {
        return HttpResponse::BadRequest().body("orgUnitId is invalid for tenant");
    }

    let business_rule = BusinessRule {
        id: Uuid::new_v4(),
        tenant_id,
        org_unit_id: request.org_unit_id,
        title: title.to_string(),
        rule_text: rule_text.to_string(),
        scope,
        active: request.active.unwrap_or(true),
        priority: request.priority.unwrap_or(100),
    };
    state.business_rules.push(business_rule.clone());
    HttpResponse::Created().json(business_rule)
}

async fn create_action(
    data: web::Data<AppState>,
    request: web::Json<CreateActionRequest>,
) -> impl Responder {
    if request.name.trim().is_empty()
        || request.description.trim().is_empty()
        || request.category.trim().is_empty()
        || request.classification_types.is_empty()
    {
        return HttpResponse::BadRequest()
            .body("name, description, category, and classificationTypes are required");
    }

    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let mut state = lock_state(&data);
    ensure_tenant_exists(&mut state, &tenant_id);
    let assigned_org_unit_id =
        if let Some(assigned_org_unit_id) = request.assigned_org_unit_id {
            if state.org_units.iter().any(|org_unit| {
                org_unit.id == assigned_org_unit_id && org_unit.tenant_id == tenant_id
            }) {
                assigned_org_unit_id
            } else {
                return HttpResponse::BadRequest().body("assignedOrgUnitId is invalid for tenant");
            }
        } else {
            ensure_default_org_unit(&mut state, &tenant_id)
        };

    let action = ActionDefinition {
        id: Uuid::new_v4(),
        tenant_id,
        name: request.name.trim().to_string(),
        description: request.description.trim().to_string(),
        category: request.category.trim().to_lowercase(),
        classification_types: request
            .classification_types
            .iter()
            .map(|classification| classification.trim().to_lowercase())
            .filter(|classification| !classification.is_empty())
            .collect(),
        assigned_org_unit_id,
        default_owner_role: request
            .default_owner_role
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        active: request.active.unwrap_or(true),
        execution_provider: request
            .execution_provider
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("internal")
            .to_lowercase(),
    };

    if action.classification_types.is_empty() {
        return HttpResponse::BadRequest().body("classificationTypes cannot be empty");
    }

    state.actions.push(action.clone());
    HttpResponse::Created().json(action)
}

async fn list_actions(data: web::Data<AppState>, query: web::Query<ActionQuery>) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let classification_type = query
        .classification_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let action_service = application::action_service::ActionService::new(data);
    let actions = action_service.list_actions(tenant_id, classification_type);
    HttpResponse::Ok().json(actions)
}

async fn upsert_vault_key(
    data: web::Data<AppState>,
    request: web::Json<UpsertTenantSecretRequest>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let key_name = request.key_name.trim().to_lowercase();
    let provider = request.provider.trim().to_lowercase();
    let value = request.value.trim();
    if key_name.is_empty() || provider.is_empty() || value.is_empty() {
        return HttpResponse::BadRequest().body("keyName, provider, and value are required");
    }

    let Some(encrypted_value) = data.vault_crypto.encrypt(value) else {
        return HttpResponse::InternalServerError().body("failed to encrypt secret");
    };

    let mut state = lock_state(&data);
    if let Some(existing) = state.tenant_secrets.iter_mut().find(|secret| {
        secret.tenant_id == tenant_id && secret.key_name == key_name && secret.provider == provider
    }) {
        existing.encrypted_value = encrypted_value;
        existing.created_at = Utc::now();
        data.event_bus
            .publish(domain::events::DomainEvent::VaultKeyUpdated {
                tenant_id: existing.tenant_id.clone(),
                key_id: existing.id.to_string(),
            });
        return HttpResponse::Created().json(tenant_secret_summary(existing));
    }

    let secret = TenantSecret {
        id: Uuid::new_v4(),
        tenant_id,
        key_name,
        encrypted_value,
        provider,
        created_at: Utc::now(),
    };
    let summary = tenant_secret_summary(&secret);
    data.event_bus
        .publish(domain::events::DomainEvent::VaultKeyUpdated {
            tenant_id: secret.tenant_id.clone(),
            key_id: secret.id.to_string(),
        });
    state.tenant_secrets.push(secret);
    HttpResponse::Created().json(summary)
}

async fn list_vault_keys(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let vault_service = application::vault_service::VaultService::new(data);
    let keys = vault_service.list_keys(&tenant_id);
    HttpResponse::Ok().json(keys)
}

async fn delete_vault_key(
    data: web::Data<AppState>,
    query: web::Query<DeleteTenantSecretQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let Some(key_name) = query
        .key_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
    else {
        return HttpResponse::BadRequest().body("keyName is required");
    };
    let provider = query
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    let mut state = lock_state(&data);
    let before = state.tenant_secrets.len();
    let mut removed_ids = Vec::new();
    state.tenant_secrets.retain(|secret| {
        if secret.tenant_id != tenant_id || secret.key_name != key_name {
            return true;
        }
        if let Some(provider) = provider.as_deref() {
            return secret.provider != provider;
        }
        removed_ids.push(secret.id);
        false
    });

    if before == state.tenant_secrets.len() {
        return HttpResponse::NotFound().body("secret not found");
    }
    for secret_id in removed_ids {
        data.event_bus
            .publish(domain::events::DomainEvent::VaultKeyUpdated {
                tenant_id: tenant_id.clone(),
                key_id: secret_id.to_string(),
            });
    }

    HttpResponse::NoContent().finish()
}

async fn execute_action(
    data: web::Data<AppState>,
    request: web::Json<ExecuteActionRequest>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
    let payload = request
        .payload
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    let idempotency_key = resolve_idempotency_key(
        request.idempotency_key.as_deref(),
        format!(
            "{}:{}:{}:{:?}:{}",
            tenant_id,
            request.work_item_id,
            request.action_id.unwrap_or_default(),
            request.action_name,
            payload
        ),
    );
    if let Some(existing) = data
        .event_bus
        .get_idempotency("execute_action", &idempotency_key)
        .and_then(|value| serde_json::from_value::<ExecutionResultRecord>(value).ok())
    {
        return HttpResponse::Ok().json(existing);
    }

    let (action, work_item, provider, secrets) = {
        let state = lock_state(&data);

        let Some(work_item) = state
            .work_items
            .iter()
            .find(|work_item| {
                work_item.id == request.work_item_id && work_item.tenant_id == tenant_id
            })
            .cloned()
        else {
            return HttpResponse::NotFound().body("work item not found");
        };

        let action = if let Some(action_id) = request.action_id {
            state
                .actions
                .iter()
                .find(|action| action.id == action_id && action.tenant_id == tenant_id)
                .cloned()
        } else if let Some(action_name) = request
            .action_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            state
                .actions
                .iter()
                .find(|action| {
                    action.tenant_id == tenant_id && action.name.eq_ignore_ascii_case(action_name)
                })
                .cloned()
        } else {
            None
        };

        let Some(action) = action else {
            return HttpResponse::BadRequest().body("actionId or actionName is required");
        };

        let provider = request
            .provider
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&action.execution_provider)
            .to_lowercase();

        let secrets: HashMap<String, String> = state
            .tenant_secrets
            .iter()
            .filter(|secret| secret.tenant_id == tenant_id && secret.provider == provider)
            .filter_map(|secret| {
                data.vault_crypto
                    .decrypt(&secret.encrypted_value)
                    .map(|value| (secret.key_name.clone(), value))
            })
            .collect();

        (action, work_item, provider, secrets)
    };

    let executor = executor_for_provider(&provider);
    let result = executor.execute(&action, &work_item, &payload, &secrets);
    if !is_valid_execution_status(&result.status) {
        return HttpResponse::InternalServerError().body("invalid execution status");
    }

    let execution_id = Uuid::new_v4();
    let executed_at = Utc::now();
    let summary = result
        .message
        .clone()
        .unwrap_or_else(|| format!("Executed {} via {}", action.name, provider));
    let result_type = if result.status == "failed" {
        "no_op".to_string()
    } else if provider.eq_ignore_ascii_case("internal") {
        "state_change".to_string()
    } else {
        "external_api_call".to_string()
    };
    let mut side_effects = vec![ExecutionSideEffect {
        side_effect_type: "action_execution".to_string(),
        target_system: Some(provider.clone()),
        target_id: result.external_ref.clone(),
        description: summary.clone(),
    }];
    if result.status == "failed" {
        side_effects.push(ExecutionSideEffect {
            side_effect_type: "execution_failure".to_string(),
            target_system: Some(provider.clone()),
            target_id: None,
            description: "Execution failed before work state transition.".to_string(),
        });
    }
    let context_snapshot = serde_json::json!({
        "classificationType": work_item.classification_type,
        "priority": work_item.priority,
        "status": work_item.status,
        "assignedOrgUnitId": work_item.assigned_org_unit_id,
        "routingPath": work_item.routing_path,
        "escalationTarget": work_item.escalation_target,
        "suppressAction": work_item.suppress_action,
        "requireApproval": work_item.require_approval,
        "appliedRules": work_item.applied_rules,
        "operationalMeaning": work_item.operational_meaning,
    });
    let execution = ExecutionResultRecord {
        id: execution_id,
        tenant_id: tenant_id.clone(),
        work_item_id: work_item.id,
        action_id: action.id,
        executed_by: "system".to_string(),
        execution_type: if provider.eq_ignore_ascii_case("internal") {
            "internal_update".to_string()
        } else {
            "external_signal".to_string()
        },
        status: result.status,
        result_type,
        summary: summary.clone(),
        side_effects,
        context_snapshot,
        timestamp: executed_at.timestamp(),
        provider: provider.clone(),
        external_ref: result.external_ref,
        payload: serde_json::json!({
            "actionName": action.name,
            "provider": provider,
            "requestPayload": payload,
            "message": result.message,
        }),
        message: Some(summary),
        executed_at: Some(executed_at),
    };

    let mut state = lock_state(&data);
    state.execution_results.push(execution.clone());
    let event_id = runtime_flow::emit_action_executed_event(
        &data.event_bus,
        &tenant_id,
        execution.id,
        action.id,
        &execution.status,
    );
    data.event_bus.mark_projection_success(&event_id);
    data.event_bus.put_idempotency(
        "execute_action",
        &idempotency_key,
        serde_json::to_value(&execution).unwrap_or_else(|_| serde_json::json!({})),
    );
    refresh_behavioral_patterns_for_tenant(&mut state, &tenant_id);
    HttpResponse::Created().json(execution)
}

async fn list_executions(
    data: web::Data<AppState>,
    query: web::Query<ExecutionListQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let state = lock_state(&data);
    let executions: Vec<ExecutionResultRecord> = state
        .execution_results
        .iter()
        .filter(|execution| execution.tenant_id == tenant_id)
        .filter(|execution| {
            if let Some(work_item_id) = query.work_item_id {
                execution.work_item_id == work_item_id
            } else {
                true
            }
        })
        .cloned()
        .collect();
    HttpResponse::Ok().json(executions)
}

async fn get_execution(
    data: web::Data<AppState>,
    execution_id: web::Path<Uuid>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let state = lock_state(&data);
    let Some(execution) = state
        .execution_results
        .iter()
        .find(|execution| execution.id == *execution_id && execution.tenant_id == tenant_id)
    else {
        return HttpResponse::NotFound().body("execution not found");
    };
    HttpResponse::Ok().json(execution)
}

fn infer_behavioral_patterns(state: &State, tenant_id: &str) -> Vec<BehavioralPattern> {
    let now = Utc::now().timestamp();
    let mut patterns: Vec<BehavioralPattern> = Vec::new();
    let tenant_work_items: Vec<&WorkItem> = state
        .work_items
        .iter()
        .filter(|work_item| work_item.tenant_id == tenant_id)
        .collect();
    let work_by_id: HashMap<Uuid, &WorkItem> = tenant_work_items
        .iter()
        .map(|work_item| (work_item.id, *work_item))
        .collect();
    let org_unit_by_id: HashMap<Uuid, &OrgUnit> = state
        .org_units
        .iter()
        .filter(|org_unit| org_unit.tenant_id == tenant_id)
        .map(|org_unit| (org_unit.id, org_unit))
        .collect();
    let action_by_name: HashMap<String, &ActionDefinition> = state
        .actions
        .iter()
        .filter(|action| action.tenant_id == tenant_id)
        .map(|action| (action.name.to_lowercase(), action))
        .collect();

    let tenant_selections: Vec<&ActionSelection> = state
        .action_selections
        .iter()
        .filter(|selection| selection.tenant_id == tenant_id)
        .collect();
    if !tenant_selections.is_empty() {
        let mut latest_selection_by_work_item: HashMap<Uuid, &ActionSelection> = HashMap::new();
        for selection in tenant_selections.iter().copied() {
            let entry = latest_selection_by_work_item
                .entry(selection.work_item_id)
                .or_insert(selection);
            if selection.selected_at > entry.selected_at {
                *entry = selection;
            }
        }

        let mut routing_mismatch_by_path: HashMap<(String, String), usize> = HashMap::new();
        let mut routing_mismatch_count: usize = 0;
        let mut routing_first_observed_at = i64::MAX;
        let mut routing_last_observed_at = 0;

        for (work_item_id, selection) in latest_selection_by_work_item {
            let Some(work_item) = work_by_id.get(&work_item_id) else {
                continue;
            };
            let Some(action) = action_by_name.get(&selection.tenant_action.to_lowercase()) else {
                continue;
            };
            if action.assigned_org_unit_id == work_item.assigned_org_unit_id {
                continue;
            }

            routing_mismatch_count += 1;
            let from_org_unit = org_unit_by_id
                .get(&work_item.assigned_org_unit_id)
                .map(|org_unit| org_unit.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            let to_org_unit = org_unit_by_id
                .get(&action.assigned_org_unit_id)
                .map(|org_unit| org_unit.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            *routing_mismatch_by_path
                .entry((from_org_unit, to_org_unit))
                .or_insert(0) += 1;

            let selected_at = selection.selected_at.timestamp();
            routing_first_observed_at = routing_first_observed_at.min(selected_at);
            routing_last_observed_at = routing_last_observed_at.max(selected_at);
        }

        if routing_mismatch_count > 0 {
            let total = tenant_selections.len() as f64;
            let ratio = routing_mismatch_count as f64 / total;
            let ((from_org_unit, to_org_unit), path_count) = routing_mismatch_by_path
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .unwrap_or((("Unknown".to_string(), "Unknown".to_string()), 0));

            patterns.push(BehavioralPattern {
                id: Uuid::new_v4(),
                tenant_id: tenant_id.to_string(),
                pattern_type: "routing_bias".to_string(),
                description: format!(
                    "Routing frequently shifts from {from_org_unit} to {to_org_unit} before resolution"
                ),
                evidence: serde_json::json!({
                    "reassignmentCount": routing_mismatch_count,
                    "observedSelections": tenant_selections.len(),
                    "dominantPath": {
                        "from": from_org_unit,
                        "to": to_org_unit,
                        "count": path_count,
                    },
                }),
                confidence: ratio,
                impact_score: (ratio * 100.0).round(),
                first_observed_at: if routing_first_observed_at == i64::MAX {
                    now
                } else {
                    routing_first_observed_at
                },
                last_observed_at: if routing_last_observed_at == 0 {
                    now
                } else {
                    routing_last_observed_at
                },
            });
        }

        let drifted_selections: Vec<&ActionSelection> = tenant_selections
            .iter()
            .copied()
            .filter(|selection| {
                !selection
                    .system_action
                    .eq_ignore_ascii_case(selection.tenant_action.as_str())
            })
            .collect();
        if !drifted_selections.is_empty() {
            let mut overrides: HashMap<(String, String), usize> = HashMap::new();
            let mut first_observed_at = i64::MAX;
            let mut last_observed_at = 0;
            for selection in drifted_selections.iter().copied() {
                *overrides
                    .entry((
                        selection.system_action.clone(),
                        selection.tenant_action.clone(),
                    ))
                    .or_insert(0) += 1;
                let selected_at = selection.selected_at.timestamp();
                first_observed_at = first_observed_at.min(selected_at);
                last_observed_at = last_observed_at.max(selected_at);
            }
            let ((system_action, tenant_action), override_count) = overrides
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .unwrap_or((("unknown".to_string(), "unknown".to_string()), 0));
            let ratio = drifted_selections.len() as f64 / tenant_selections.len() as f64;

            patterns.push(BehavioralPattern {
                id: Uuid::new_v4(),
                tenant_id: tenant_id.to_string(),
                pattern_type: "action_drift".to_string(),
                description: format!(
                    "System action '{system_action}' is frequently overridden to '{tenant_action}'"
                ),
                evidence: serde_json::json!({
                    "driftCount": drifted_selections.len(),
                    "observedSelections": tenant_selections.len(),
                    "topOverride": {
                        "systemAction": system_action,
                        "tenantAction": tenant_action,
                        "count": override_count,
                    },
                }),
                confidence: ratio,
                impact_score: (ratio * 100.0).round(),
                first_observed_at: if first_observed_at == i64::MAX {
                    now
                } else {
                    first_observed_at
                },
                last_observed_at: if last_observed_at == 0 {
                    now
                } else {
                    last_observed_at
                },
            });
        }
    }

    let tenant_executions: Vec<&ExecutionResultRecord> = state
        .execution_results
        .iter()
        .filter(|execution| execution.tenant_id == tenant_id)
        .filter(|execution| execution.executed_at.is_some())
        .collect();
    if !tenant_executions.is_empty() {
        let external_executions: Vec<&ExecutionResultRecord> = tenant_executions
            .iter()
            .copied()
            .filter(|execution| !execution.provider.eq_ignore_ascii_case("internal"))
            .collect();
        if !external_executions.is_empty() {
            let mut provider_counts: HashMap<String, usize> = HashMap::new();
            let mut first_observed_at = i64::MAX;
            let mut last_observed_at = 0;
            for execution in external_executions.iter().copied() {
                *provider_counts
                    .entry(execution.provider.clone())
                    .or_insert(0) += 1;
                if let Some(executed_at) = execution.executed_at {
                    first_observed_at = first_observed_at.min(executed_at.timestamp());
                    last_observed_at = last_observed_at.max(executed_at.timestamp());
                }
            }
            let (provider, count) = provider_counts
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .unwrap_or(("unknown".to_string(), 0));
            let ratio = external_executions.len() as f64 / tenant_executions.len() as f64;

            patterns.push(BehavioralPattern {
                id: Uuid::new_v4(),
                tenant_id: tenant_id.to_string(),
                pattern_type: "bypass_behavior".to_string(),
                description: format!(
                    "Execution is frequently handled through external provider '{provider}' instead of internal actions"
                ),
                evidence: serde_json::json!({
                    "externalExecutionCount": external_executions.len(),
                    "observedExecutions": tenant_executions.len(),
                    "dominantProvider": provider,
                    "dominantProviderCount": count,
                }),
                confidence: ratio,
                impact_score: (ratio * 100.0).round(),
                first_observed_at: if first_observed_at == i64::MAX {
                    now
                } else {
                    first_observed_at
                },
                last_observed_at: if last_observed_at == 0 {
                    now
                } else {
                    last_observed_at
                },
            });
        }
    }

    let unresolved_work_items: Vec<&WorkItem> = tenant_work_items
        .iter()
        .copied()
        .filter(|work_item| {
            !matches!(
                work_item.status.as_str(),
                "completed" | "failed" | "duplicate" | "irrelevant"
            )
        })
        .collect();
    if unresolved_work_items.len() >= 2 {
        let mut unresolved_by_org_unit: HashMap<Uuid, usize> = HashMap::new();
        for work_item in unresolved_work_items.iter().copied() {
            *unresolved_by_org_unit
                .entry(work_item.assigned_org_unit_id)
                .or_insert(0) += 1;
        }

        let (org_unit_id, count) = unresolved_by_org_unit
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .unwrap_or((Uuid::nil(), 0));
        let ratio = count as f64 / unresolved_work_items.len() as f64;
        if ratio >= 0.5 {
            let unresolved_ingress_ids: HashSet<Uuid> = unresolved_work_items
                .iter()
                .map(|work_item| work_item.inbox_item_id)
                .collect();
            let first_observed_at = state
                .ingress_events
                .iter()
                .filter(|event| {
                    event.tenant_id == tenant_id
                        && unresolved_ingress_ids.contains(&event.ingress_id)
                        && event.event_type == "work_generated"
                })
                .map(|event| event.created_at.timestamp())
                .min()
                .unwrap_or(now);
            let last_observed_at = state
                .ingress_events
                .iter()
                .filter(|event| {
                    event.tenant_id == tenant_id
                        && unresolved_ingress_ids.contains(&event.ingress_id)
                        && event.event_type == "work_generated"
                })
                .map(|event| event.created_at.timestamp())
                .max()
                .unwrap_or(now);
            let org_unit_name = org_unit_by_id
                .get(&org_unit_id)
                .map(|org_unit| org_unit.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            patterns.push(BehavioralPattern {
                id: Uuid::new_v4(),
                tenant_id: tenant_id.to_string(),
                pattern_type: "org_bottleneck".to_string(),
                description: format!(
                    "{org_unit_name} currently carries most unresolved work items"
                ),
                evidence: serde_json::json!({
                    "unresolvedCount": count,
                    "totalUnresolved": unresolved_work_items.len(),
                    "orgUnit": org_unit_name,
                }),
                confidence: ratio,
                impact_score: (ratio * 100.0).round(),
                first_observed_at,
                last_observed_at,
            });
        }
    }

    patterns
}

fn refresh_behavioral_patterns_for_tenant(state: &mut State, tenant_id: &str) {
    state
        .behavioral_patterns
        .retain(|pattern| pattern.tenant_id != tenant_id);
    let inferred = infer_behavioral_patterns(state, tenant_id);
    state.behavioral_patterns.extend(inferred);
}

async fn list_behavioral_patterns(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let mut state = lock_state(&data);
    refresh_behavioral_patterns_for_tenant(&mut state, &tenant_id);
    let patterns: Vec<BehavioralPattern> = state
        .behavioral_patterns
        .iter()
        .filter(|pattern| pattern.tenant_id == tenant_id)
        .cloned()
        .collect();
    HttpResponse::Ok().json(patterns)
}

fn format_process_name(classification_type: &str) -> String {
    let mut words = classification_type
        .split('_')
        .filter(|segment| !segment.trim().is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str().to_lowercase().as_str()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<String>>();
    if words.is_empty() {
        words.push("Operational".to_string());
    }
    format!("{} Handling", words.join(" "))
}

fn infer_process_graph(state: &mut State, tenant_id: &str) -> ProcessGraph {
    let now = Utc::now().timestamp();
    let tenant_work_items: Vec<&WorkItem> = state
        .work_items
        .iter()
        .filter(|work_item| work_item.tenant_id == tenant_id)
        .collect();
    let tenant_selections: Vec<&ActionSelection> = state
        .action_selections
        .iter()
        .filter(|selection| selection.tenant_id == tenant_id)
        .collect();
    let tenant_executions: Vec<&ExecutionResultRecord> = state
        .execution_results
        .iter()
        .filter(|execution| execution.tenant_id == tenant_id)
        .collect();
    let tenant_outcomes: Vec<&WorkOutcome> = state
        .work_outcomes
        .iter()
        .filter(|outcome| outcome.tenant_id == tenant_id)
        .collect();

    let process_name = tenant_work_items
        .first()
        .map(|work_item| format_process_name(&work_item.classification_type))
        .unwrap_or_else(|| "Operational Request Handling".to_string());
    let total_work = tenant_work_items.len() as f64;
    let denominator = if total_work > 0.0 { total_work } else { 1.0 };

    let drifted_selection_count = tenant_selections
        .iter()
        .filter(|selection| {
            !selection
                .system_action
                .eq_ignore_ascii_case(selection.tenant_action.as_str())
        })
        .count() as f64;
    let external_execution_count = tenant_executions
        .iter()
        .filter(|execution| !execution.provider.eq_ignore_ascii_case("internal"))
        .count() as f64;
    let escalated_work_count = tenant_work_items
        .iter()
        .filter(|work_item| work_item.escalation_target.is_some() || work_item.require_approval)
        .count() as f64;
    let unresolved_count = tenant_work_items
        .iter()
        .filter(|work_item| {
            !matches!(
                work_item.status.as_str(),
                "completed" | "failed" | "duplicate" | "irrelevant"
            )
        })
        .count() as f64;
    let completed_count = tenant_outcomes
        .iter()
        .filter(|outcome| {
            matches!(
                outcome.status.as_str(),
                "completed" | "failed" | "duplicate" | "irrelevant"
            )
        })
        .count() as f64;
    let completion_count = completed_count.max(total_work - unresolved_count);

    let org_unit_by_id: HashMap<Uuid, &OrgUnit> = state
        .org_units
        .iter()
        .filter(|org_unit| org_unit.tenant_id == tenant_id)
        .map(|org_unit| (org_unit.id, org_unit))
        .collect();

    let mut node_ids_by_name: HashMap<String, Uuid> = HashMap::new();
    let mut process_nodes: Vec<ProcessNode> = Vec::new();
    let mut ensure_node =
        |name: &str, node_type: &str, source: &str, confidence: f64, org_unit_id: Option<Uuid>| {
            if let Some(existing_id) = node_ids_by_name.get(name) {
                if let Some(existing_node) = process_nodes
                    .iter_mut()
                    .find(|node| node.id == *existing_id)
                {
                    existing_node.confidence = existing_node.confidence.max(confidence);
                    existing_node.first_seen_at = existing_node.first_seen_at.min(now);
                    existing_node.last_seen_at = existing_node.last_seen_at.max(now);
                    existing_node.source = source.to_string();
                    existing_node.org_unit_id = org_unit_id;
                }
                *existing_id
            } else {
                let id = Uuid::new_v4();
                process_nodes.push(ProcessNode {
                    id,
                    tenant_id: tenant_id.to_string(),
                    org_unit_id,
                    name: name.to_string(),
                    node_type: node_type.to_string(),
                    source: source.to_string(),
                    confidence: confidence.clamp(0.0, 1.0),
                    first_seen_at: now,
                    last_seen_at: now,
                });
                node_ids_by_name.insert(name.to_string(), id);
                id
            }
        };

    let process_id = ensure_node(&process_name, "process", "inferred", 1.0, None);
    let intake_id = ensure_node("Intake", "step", "inferred", 1.0, None);
    let maintenance_review_org_unit = tenant_work_items
        .first()
        .map(|work_item| work_item.assigned_org_unit_id);
    let maintenance_review_id = ensure_node(
        "Maintenance Review",
        "step",
        "inferred",
        (total_work / denominator).clamp(0.0, 1.0),
        maintenance_review_org_unit,
    );
    let completion_id = ensure_node(
        "Completion",
        "step",
        "inferred",
        (completion_count / denominator).clamp(0.0, 1.0),
        None,
    );

    let mut process_edges: Vec<ProcessEdge> = Vec::new();
    let mut add_edge =
        |from_node_id: Uuid, to_node_id: Uuid, transition_type: &str, frequency: f64| {
            if frequency <= 0.0 {
                return;
            }
            if let Some(existing_edge) = process_edges.iter_mut().find(|edge| {
                edge.from_node_id == from_node_id
                    && edge.to_node_id == to_node_id
                    && edge.transition_type == transition_type
            }) {
                existing_edge.frequency += frequency;
                existing_edge.confidence = (existing_edge.frequency / denominator).clamp(0.0, 1.0);
                return;
            }
            process_edges.push(ProcessEdge {
                id: Uuid::new_v4(),
                tenant_id: tenant_id.to_string(),
                from_node_id,
                to_node_id,
                transition_type: transition_type.to_string(),
                frequency,
                confidence: (frequency / denominator).clamp(0.0, 1.0),
            });
        };

    add_edge(process_id, intake_id, "normal_flow", denominator);
    add_edge(intake_id, maintenance_review_id, "normal_flow", denominator);

    let mut bypass_paths: Vec<String> = Vec::new();
    if drifted_selection_count > 0.0 {
        let override_id = ensure_node(
            "Operations Override",
            "exception_path",
            "inferred",
            (drifted_selection_count / denominator).clamp(0.0, 1.0),
            None,
        );
        add_edge(
            maintenance_review_id,
            override_id,
            "bypass",
            drifted_selection_count,
        );
        add_edge(
            override_id,
            completion_id,
            "normal_flow",
            drifted_selection_count,
        );
        bypass_paths.push("Maintenance Review → Operations Override".to_string());
    }

    if escalated_work_count > 0.0 {
        let escalation_id = ensure_node(
            "Escalation",
            "decision",
            "inferred",
            (escalated_work_count / denominator).clamp(0.0, 1.0),
            None,
        );
        add_edge(
            maintenance_review_id,
            escalation_id,
            "escalation",
            escalated_work_count,
        );
        add_edge(escalation_id, completion_id, "retry", escalated_work_count);
        bypass_paths.push("Maintenance Review → Escalation".to_string());
    }

    let external_execution_points: Vec<String> = tenant_executions
        .iter()
        .filter(|execution| !execution.provider.eq_ignore_ascii_case("internal"))
        .map(|execution| format!("{} ({})", execution.provider, execution.status))
        .collect();
    if external_execution_count > 0.0 {
        let vendor_call_id = ensure_node(
            "Vendor Call",
            "exception_path",
            "inferred",
            (external_execution_count / denominator).clamp(0.0, 1.0),
            None,
        );
        add_edge(
            maintenance_review_id,
            vendor_call_id,
            "external",
            external_execution_count,
        );
        add_edge(
            vendor_call_id,
            completion_id,
            "normal_flow",
            external_execution_count,
        );
        if !bypass_paths
            .iter()
            .any(|path| path == "Maintenance Review → Vendor Call")
        {
            bypass_paths.push("Maintenance Review → Vendor Call".to_string());
        }
    }

    let direct_completion_count =
        (denominator - drifted_selection_count - escalated_work_count - external_execution_count)
            .max(0.0);
    add_edge(
        maintenance_review_id,
        completion_id,
        "normal_flow",
        direct_completion_count,
    );

    let mut unresolved_by_org_unit: HashMap<Uuid, usize> = HashMap::new();
    for work_item in tenant_work_items.iter().copied().filter(|work_item| {
        !matches!(
            work_item.status.as_str(),
            "completed" | "failed" | "duplicate" | "irrelevant"
        )
    }) {
        *unresolved_by_org_unit
            .entry(work_item.assigned_org_unit_id)
            .or_insert(0) += 1;
    }
    let bottlenecks = unresolved_by_org_unit
        .into_iter()
        .filter_map(|(org_unit_id, count)| {
            if count as f64 / denominator < 0.4 {
                return None;
            }
            let org_unit_name = org_unit_by_id
                .get(&org_unit_id)
                .map(|org_unit| org_unit.name.as_str())
                .unwrap_or("Unknown");
            Some(format!(
                "{org_unit_name} holds {count} unresolved work items"
            ))
        })
        .collect();

    let drift_score = ((drifted_selection_count / denominator)
        + (external_execution_count / denominator)
        + (escalated_work_count / denominator)
        + (unresolved_count / denominator))
        / 4.0;

    state
        .process_nodes
        .retain(|node| node.tenant_id != tenant_id);
    state.process_nodes.extend(process_nodes.iter().cloned());
    state
        .process_edges
        .retain(|edge| edge.tenant_id != tenant_id);
    state.process_edges.extend(process_edges.iter().cloned());

    ProcessGraph {
        tenant_id: tenant_id.to_string(),
        process_name,
        process_nodes,
        process_edges,
        designed_process: vec![
            "Intake".to_string(),
            "Assign Maintenance".to_string(),
            "Resolve".to_string(),
            "Close".to_string(),
        ],
        drift_score: drift_score.clamp(0.0, 1.0),
        bottlenecks,
        bypass_paths,
        external_execution_points,
    }
}

async fn get_process_graph(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let mut state = lock_state(&data);
    let graph = infer_process_graph(&mut state, &tenant_id);
    HttpResponse::Ok().json(graph)
}

fn infer_operational_artifacts(state: &mut State, tenant_id: &str) -> Vec<OperationalArtifact> {
    let now = Utc::now().timestamp();
    let process_graph = infer_process_graph(state, tenant_id);
    let behavioral_patterns = infer_behavioral_patterns(state, tenant_id);
    let top_bypass = process_graph.bypass_paths.first().cloned();

    let mut policy_recommendations: Vec<String> = behavioral_patterns
        .iter()
        .filter_map(|pattern| match pattern.pattern_type.as_str() {
            "bypass_behavior" if pattern.confidence >= 0.4 => Some(
                "Approve external vendor escalation for urgent incidents with execution logging."
                    .to_string(),
            ),
            "action_drift" if pattern.confidence >= 0.3 => Some(
                "Formalize common operator overrides as approved routing options.".to_string(),
            ),
            "org_bottleneck" if pattern.confidence >= 0.5 => Some(
                "Introduce triage escalation policy when unresolved queue concentration exceeds 50%."
                    .to_string(),
            ),
            _ => None,
        })
        .collect();
    if policy_recommendations.is_empty() {
        policy_recommendations.push(
            "Maintain current routing policy and continue monitoring for drift signals."
                .to_string(),
        );
    }

    let sop_steps: Vec<String> = if process_graph.designed_process.is_empty() {
        vec![
            "Capture incoming operational signal".to_string(),
            "Assign to responsible team".to_string(),
            "Resolve and close with documented outcome".to_string(),
        ]
    } else {
        process_graph
            .designed_process
            .iter()
            .enumerate()
            .map(|(index, step)| format!("{}. {}", index + 1, step))
            .collect()
    };

    let artifacts = vec![
        OperationalArtifact {
            tenant_id: tenant_id.to_string(),
            name: format!("{} Process Map (As-Is)", process_graph.process_name),
            artifact_type: "process_map".to_string(),
            org_unit_id: None,
            source: "inferred".to_string(),
            version: 1,
            content: serde_json::json!({
                "designedFlow": process_graph.designed_process,
                "observedEdges": process_graph.process_edges,
                "bypassPaths": process_graph.bypass_paths,
                "driftScore": process_graph.drift_score,
                "externalExecutionPoints": process_graph.external_execution_points,
            }),
            derived_from: vec![
                "process_nodes".to_string(),
                "process_edges".to_string(),
                "action_selections".to_string(),
                "execution_results".to_string(),
            ],
            last_updated_at: now,
        },
        OperationalArtifact {
            tenant_id: tenant_id.to_string(),
            name: format!(
                "Standard Operating Procedure: {}",
                process_graph.process_name
            ),
            artifact_type: "SOP".to_string(),
            org_unit_id: None,
            source: "generated".to_string(),
            version: 1,
            content: serde_json::json!({
                "title": process_graph.process_name,
                "steps": sop_steps,
                "notes": top_bypass.map(|path| format!("Observed deviation: {path}")),
            }),
            derived_from: vec![
                "process_nodes".to_string(),
                "process_edges".to_string(),
                "work_outcomes".to_string(),
            ],
            last_updated_at: now,
        },
        OperationalArtifact {
            tenant_id: tenant_id.to_string(),
            name: "Policy Recommendations From Observed Behavior".to_string(),
            artifact_type: "policy".to_string(),
            org_unit_id: None,
            source: "generated".to_string(),
            version: 1,
            content: serde_json::json!({
                "recommendations": policy_recommendations,
                "basedOnPatterns": behavioral_patterns,
            }),
            derived_from: vec![
                "behavioral_patterns".to_string(),
                "action_selections".to_string(),
                "execution_results".to_string(),
            ],
            last_updated_at: now,
        },
        OperationalArtifact {
            tenant_id: tenant_id.to_string(),
            name: "Exception Decision Tree".to_string(),
            artifact_type: "decision_tree".to_string(),
            org_unit_id: None,
            source: "generated".to_string(),
            version: 1,
            content: serde_json::json!({
                "entry": "Maintenance Review",
                "branches": [
                    {
                        "condition": "External provider needed",
                        "nextStep": "Vendor Call",
                    },
                    {
                        "condition": "Approval or escalation required",
                        "nextStep": "Escalation",
                    },
                    {
                        "condition": "Standard flow",
                        "nextStep": "Completion",
                    }
                ],
            }),
            derived_from: vec![
                "process_edges".to_string(),
                "business_rules".to_string(),
                "work_items".to_string(),
            ],
            last_updated_at: now,
        },
        OperationalArtifact {
            tenant_id: tenant_id.to_string(),
            name: "Operational Drift Swimlane".to_string(),
            artifact_type: "swimlane".to_string(),
            org_unit_id: None,
            source: "generated".to_string(),
            version: 1,
            content: serde_json::json!({
                "driftScore": process_graph.drift_score,
                "bottlenecks": process_graph.bottlenecks,
                "bypassPaths": process_graph.bypass_paths,
                "externalExecutionPoints": process_graph.external_execution_points,
            }),
            derived_from: vec![
                "behavioral_patterns".to_string(),
                "process_edges".to_string(),
                "work_items".to_string(),
            ],
            last_updated_at: now,
        },
    ];

    state
        .operational_artifacts
        .retain(|artifact| artifact.tenant_id != tenant_id);
    state
        .operational_artifacts
        .extend(artifacts.iter().cloned());
    artifacts
}

async fn list_operational_artifacts(
    data: web::Data<AppState>,
    query: web::Query<OperationalArtifactQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let mut state = lock_state(&data);
    let artifacts = infer_operational_artifacts(&mut state, &tenant_id);
    let type_filter = query
        .artifact_type
        .as_ref()
        .map(|value| value.to_lowercase());
    let search_filter = query.q.as_ref().map(|value| value.to_lowercase());
    let filtered: Vec<OperationalArtifact> = artifacts
        .into_iter()
        .filter(|artifact| {
            if let Some(filter) = type_filter.as_ref() {
                if artifact.artifact_type.to_lowercase() != *filter {
                    return false;
                }
            }
            if let Some(filter) = search_filter.as_ref() {
                let haystack = format!(
                    "{} {} {}",
                    artifact.name, artifact.artifact_type, artifact.content
                )
                .to_lowercase();
                return haystack.contains(filter);
            }
            true
        })
        .collect();
    HttpResponse::Ok().json(filtered)
}

async fn list_items(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let state = lock_state(&data);
    let items: Vec<InboxItem> = state
        .inbox_items
        .iter()
        .filter(|item| item.tenant_id == tenant_id)
        .cloned()
        .collect();
    HttpResponse::Ok().json(items)
}

async fn list_work(
    data: web::Data<AppState>,
    query: web::Query<TenantScopedQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let work_service = application::work_service::WorkService::new(data);
    let work_items = work_service.list_work(&tenant_id);
    HttpResponse::Ok().json(work_items)
}

async fn work_routing_preview(
    data: web::Data<AppState>,
    query: web::Query<RoutingPreviewQuery>,
) -> impl Responder {
    let tenant_id = resolve_tenant_id(query.tenant_id.as_deref());
    let classification_type = query
        .classification_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("operational_request")
        .to_string();
    let action_name = query
        .action_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let signal_content = query
        .signal_content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let routing_service = application::routing_service::RoutingService::new(data);
    let preview =
        routing_service.preview(tenant_id, classification_type, action_name, signal_content);
    HttpResponse::Ok().json(preview)
}

async fn select_work_action(
    data: web::Data<AppState>,
    work_item_id: web::Path<Uuid>,
    request: web::Json<SelectWorkActionRequest>,
) -> impl Responder {
    let system_action = request.system_action.trim();
    if system_action.is_empty() {
        return HttpResponse::BadRequest().body("systemAction is required");
    }

    let selected_at = request
        .selected_at
        .and_then(datetime_from_unix_timestamp)
        .unwrap_or_else(Utc::now);
    let (selection, ingress_event, ingress_id) = {
        let mut state = lock_state(&data);
        let Some(work_item) = state
            .work_items
            .iter_mut()
            .find(|work_item| work_item.id == *work_item_id)
        else {
            return HttpResponse::NotFound().body("work item not found");
        };

        let tenant_id = work_item.tenant_id.clone();
        let ingress_id = work_item.inbox_item_id;
        let tenant_action = request
            .tenant_action
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(system_action)
            .to_string();
        work_item.status = "in_progress".to_string();

        let selection = ActionSelection {
            id: Uuid::new_v4(),
            tenant_id: tenant_id.clone(),
            work_item_id: work_item.id,
            system_action: system_action.to_string(),
            tenant_action: tenant_action.clone(),
            selected_at,
        };
        state.action_selections.push(selection.clone());
        let ingress_event = create_ingress_event(
            &mut state,
            ingress_id,
            tenant_id,
            "action_selected".to_string(),
            format!("Selected action: {tenant_action}"),
        );
        refresh_behavioral_patterns_for_tenant(&mut state, &selection.tenant_id);
        (selection, ingress_event, ingress_id)
    };

    if let Err(error) =
        forward_action_selection_to_convex(&data.client, &data.convex_config, &selection).await
    {
        eprintln!("failed to forward action selection to convex: {error}");
    }
    if let Err(error) = forward_ingress_event_to_convex(
        &data.client,
        &data.convex_config,
        ingress_id,
        &ingress_event,
    )
    .await
    {
        eprintln!("failed to forward action selection event to convex: {error}");
    }

    HttpResponse::Created().json(selection)
}

async fn record_work_outcome(
    data: web::Data<AppState>,
    work_item_id: web::Path<Uuid>,
    request: web::Json<RecordWorkOutcomeRequest>,
) -> impl Responder {
    let status = request.status.trim().to_lowercase();
    if !is_valid_outcome_status(&status) {
        return HttpResponse::BadRequest()
            .body("status must be one of: completed, failed, escalated, duplicate, irrelevant");
    }

    let feedback = request
        .feedback
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    if let Some(feedback_value) = feedback.as_deref()
        && !is_valid_feedback(feedback_value)
    {
        return HttpResponse::BadRequest()
            .body("feedback must be one of: correct, wrong, partial, escalated");
    }

    let completed_at = request
        .completed_at
        .and_then(datetime_from_unix_timestamp)
        .unwrap_or_else(Utc::now);
    let (outcome, close_event, ingress_id) = {
        let mut state = lock_state(&data);
        let Some(work_item) = state
            .work_items
            .iter_mut()
            .find(|work_item| work_item.id == *work_item_id)
        else {
            return HttpResponse::NotFound().body("work item not found");
        };

        work_item.status = status.clone();
        let tenant_id = work_item.tenant_id.clone();
        let ingress_id = work_item.inbox_item_id;
        let outcome = WorkOutcome {
            id: Uuid::new_v4(),
            tenant_id: tenant_id.clone(),
            work_item_id: work_item.id,
            selected_action_id: request
                .selected_action_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            status: status.clone(),
            resolution_notes: request
                .resolution_notes
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            feedback,
            completed_at: Some(completed_at),
        };
        state.work_outcomes.push(outcome.clone());
        let close_event = update_ingress_status(
            &mut state,
            ingress_id,
            "closed",
            format!("Outcome recorded: {}", outcome.status),
        );
        refresh_behavioral_patterns_for_tenant(&mut state, &outcome.tenant_id);
        (outcome, close_event, ingress_id)
    };

    if let Err(error) =
        forward_work_outcome_to_convex(&data.client, &data.convex_config, &outcome).await
    {
        eprintln!("failed to forward work outcome to convex: {error}");
    }
    if let Some(close_event) = close_event
        && let Err(error) = forward_status_update_to_convex(
            &data.client,
            &data.convex_config,
            ingress_id,
            &close_event,
        )
        .await
    {
        eprintln!("failed to forward closed status update to convex: {error}");
    }

    HttpResponse::Created().json(outcome)
}

async fn item_timeline(
    data: web::Data<AppState>,
    inbox_item_id: web::Path<Uuid>,
) -> impl Responder {
    let state = lock_state(&data);
    let mut timeline: Vec<IngressTimelineEntry> = state
        .ingress_events
        .iter()
        .filter(|event| event.ingress_id == *inbox_item_id)
        .map(|event| IngressTimelineEntry {
            entry_type: event.event_type.clone(),
            description: event.description.clone(),
            created_at: event.created_at.timestamp(),
        })
        .collect();
    timeline.sort_by_key(|event| event.created_at);

    HttpResponse::Ok().json(timeline)
}

async fn health(data: web::Data<AppState>) -> impl Responder {
    HttpResponse::Ok().json(ok_envelope(
        serde_json::json!({
            "status": "healthy",
            "reachable": true
        }),
        runtime_mode(&data.convex_config),
    ))
}

async fn status(data: web::Data<AppState>) -> impl Responder {
    let convex_connected = data.convex_config.is_connected();
    let mode = runtime_mode(&data.convex_config);
    HttpResponse::Ok().json(ok_envelope(
        serde_json::json!({
            "reachable": true,
            "convex": if convex_connected { "connected" } else { "missing" }
        }),
        mode,
    ))
}

async fn ingest_contract(data: web::Data<AppState>) -> impl Responder {
    HttpResponse::Ok().json(error_envelope(
        "METHOD_NOT_SUPPORTED",
        "Only POST is supported for this endpoint",
        true,
        runtime_mode(&data.convex_config),
    ))
}

async fn simulate(data: web::Data<AppState>) -> impl Responder {
    HttpResponse::Ok().json(ok_envelope(
        serde_json::json!({
            "simulation_id": Uuid::new_v4().to_string()
        }),
        runtime_mode(&data.convex_config),
    ))
}

async fn router_debug() -> impl Responder {
    HttpResponse::Ok().body(ROUTER_ACTIVE_MARKER)
}

pub(crate) fn build_app(
    app_state: web::Data<AppState>,
) -> App<
    impl actix_web::dev::ServiceFactory<
        actix_web::dev::ServiceRequest,
        Config = (),
        Response = actix_web::dev::ServiceResponse,
        Error = actix_web::Error,
        InitError = (),
    >,
> {
    App::new()
        .app_data(app_state)
        .configure(app_config)
        .route("/__router", web::get().to(router_debug))
}

async fn verify_router_mount(app_state: web::Data<AppState>) -> std::io::Result<()> {
    let app = actix_web::test::init_service(build_app(app_state)).await;

    let health_response = actix_web::test::call_service(
        &app,
        actix_web::test::TestRequest::get()
            .uri("/health")
            .to_request(),
    )
    .await;
    if !health_response.status().is_success() {
        return Err(std::io::Error::other(format!(
            "router sanity check failed: /health returned {}",
            health_response.status()
        )));
    }

    let router_response = actix_web::test::call_and_read_body(
        &app,
        actix_web::test::TestRequest::get()
            .uri("/__router")
            .to_request(),
    )
    .await;
    if router_response.as_ref() != ROUTER_ACTIVE_MARKER.as_bytes() {
        return Err(std::io::Error::other(
            "router sanity check failed: /__router marker mismatch",
        ));
    }

    Ok(())
}

fn load_convex_config() -> ConvexConfig {
    let config = Config::load();
    if config.mode() == "standalone" {
        log::warn!(
            "Convex not configured - running in standalone mode. Set CONVEX_URL and CONVEX_ADMIN_KEY (for Fly: `fly secrets set CONVEX_URL=... CONVEX_ADMIN_KEY=... -a <app>`)."
        );
    }

    ConvexConfig {
        deployment_url: config.convex_url,
        admin_key: config.convex_admin_key,
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState::new(load_convex_config()));
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    verify_router_mount(app_state.clone()).await?;
    println!("Router sanity check passed: {}", ROUTER_ACTIVE_MARKER);

    HttpServer::new(move || {
        build_app(app_state.clone()).wrap(
            Cors::default()
                .allow_any_header()
                .allow_any_method()
                .allowed_origin("https://canonflo.com")
                .allowed_origin("https://www.canonflo.com")
                .allowed_origin_fn(|origin, _| {
                    origin.to_str().unwrap_or("").ends_with(".vercel.app")
                }),
        )
    })
    .bind(format!("0.0.0.0:{port}"))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test};

    fn test_state() -> web::Data<AppState> {
        web::Data::new(AppState::new(ConvexConfig::default()))
    }

    fn connected_test_state() -> web::Data<AppState> {
        web::Data::new(AppState::new(ConvexConfig {
            deployment_url: Some("https://example.convex.cloud".to_string()),
            admin_key: Some("admin-key".to_string()),
        }))
    }

    #[actix_web::test]
    async fn health_endpoint_returns_service_status() {
        let app = test::init_service(build_app(test_state())).await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let response: Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(response["ok"], true);
        assert_eq!(response["service"], "rust-api");
        assert_eq!(response["data"]["status"], "healthy");
        assert_eq!(response["meta"]["mode"], "standalone");
        assert_eq!(response["meta"]["version"], "pr35");
    }

    #[actix_web::test]
    async fn status_endpoint_reports_standalone_mode_without_convex() {
        let app = test::init_service(build_app(test_state())).await;

        let req = test::TestRequest::get().uri("/status").to_request();
        let response: Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(response["ok"], true);
        assert_eq!(response["service"], "rust-api");
        assert_eq!(response["data"]["reachable"], true);
        assert_eq!(response["meta"]["mode"], "standalone");
        assert_eq!(response["data"]["convex"], "missing");
    }

    #[actix_web::test]
    async fn status_endpoint_reports_connected_mode_with_convex() {
        let app = test::init_service(build_app(connected_test_state())).await;

        let req = test::TestRequest::get().uri("/status").to_request();
        let response: Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(response["ok"], true);
        assert_eq!(response["meta"]["mode"], "connected");
        assert_eq!(response["data"]["convex"], "connected");
    }

    #[actix_web::test]
    async fn ingest_get_returns_structured_contract_response() {
        let app = test::init_service(build_app(test_state())).await;

        let req = test::TestRequest::get().uri("/ingest").to_request();
        let response: Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "METHOD_NOT_SUPPORTED");
        assert_eq!(response["error"]["recoverable"], true);
        assert_eq!(response["meta"]["mode"], "standalone");
    }

    #[actix_web::test]
    async fn ingest_invalid_payload_returns_structured_bad_request_not_500() {
        let app = test::init_service(build_app(test_state())).await;

        let req = test::TestRequest::post()
            .uri("/ingest")
            .set_payload("not-json")
            .to_request();
        let response = test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body: Value = test::read_body_json(response).await;
        assert_eq!(body["ok"], false);
        assert_eq!(body["error"]["code"], "INVALID_INGEST_PAYLOAD");
        assert_eq!(body["error"]["recoverable"], true);
        assert_eq!(body["meta"]["mode"], "standalone");
    }

    #[actix_web::test]
    async fn simulate_endpoint_returns_stubbed_payload() {
        let app = test::init_service(build_app(test_state())).await;

        let req = test::TestRequest::get().uri("/simulate").to_request();
        let response: Value = test::call_and_read_body_json(&app, req).await;

        assert_eq!(response["ok"], true);
        assert_eq!(response["meta"]["mode"], "standalone");
        assert!(response["data"]["simulation_id"].as_str().is_some());
    }

    #[actix_web::test]
    async fn default_tenant_uses_root_www_domain() {
        let state = State::default();
        let default_tenant = state
            .tenants
            .iter()
            .find(|tenant| tenant.id == DEFAULT_TENANT_ID)
            .expect("default tenant should exist");
        assert_eq!(default_tenant.domain, "www.canonflo.com");
    }

    #[actix_web::test]
    async fn source_type_defaults_to_expected_provenance() {
        let synthetic = default_signal_provenance("simulation");
        assert_eq!(synthetic.origin, "synthetic");
        assert_eq!(synthetic.generated_by, "scenario_engine");

        let replay = default_signal_provenance("replay");
        assert_eq!(replay.origin, "mixed");
        assert_eq!(replay.generated_by, "system");

        let real = default_signal_provenance("webhook");
        assert_eq!(real.origin, "real");
        assert_eq!(real.generated_by, "user");
    }

    #[actix_web::test]
    async fn extract_creates_maintenance_work_item() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_payload = IngestRequest {
            source: "email".to_string(),
            content: "The HVAC unit is not working and the room is too hot".to_string(),
            tenant_id: None,
        };

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&ingest_payload)
            .to_request();

        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();

        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;
        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;

        assert_eq!(work_item.inbox_item_id, inbox_item.id);
        assert_eq!(work_item.title, "Maintenance Request");
        assert_eq!(work_item.status, "open");
        assert!(!work_item.routing_path.is_empty());
        assert_eq!(work_item.recommended_actions.len(), 3);
        assert_eq!(work_item.recommended_actions[0].title, "Inspect HVAC Unit");
        let operational_meaning = work_item
            .operational_meaning
            .expect("work item should include operational meaning");
        assert_eq!(operational_meaning.entity_type, "work_item");
        assert_eq!(operational_meaning.state, "inferred");
        assert!(operational_meaning.confidence > 0.0);
        assert!(!operational_meaning.evidence.is_empty());
        assert_eq!(items[0].status, "work_generated");
    }

    #[actix_web::test]
    async fn extract_returns_not_found_for_unknown_item() {
        let app = test::init_service(build_app(test_state())).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: Uuid::new_v4(),
            })
            .to_request();

        let response = test::call_service(&app, extract_req).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn list_endpoints_return_ingested_and_extracted_data() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&IngestRequest {
                source: "manual".to_string(),
                content: "Invoice payment question".to_string(),
                tenant_id: None,
            })
            .to_request();

        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();

        let _work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;

        let work_req = test::TestRequest::get().uri("/work").to_request();
        let work: Vec<WorkItem> = test::call_and_read_body_json(&app, work_req).await;

        assert_eq!(items.len(), 1);
        assert_eq!(work.len(), 1);
        assert_eq!(work[0].title, "Billing Inquiry");
    }

    #[actix_web::test]
    async fn postmark_webhook_creates_inbox_and_work_items() {
        let app = test::init_service(build_app(test_state())).await;

        let request = test::TestRequest::post()
            .uri("/webhooks/postmark")
            .set_json(&PostmarkInboundRequest {
                from: Some("alerts@example.com".to_string()),
                from_full: Some(PostmarkAddress {
                    email: Some("alerts@example.com".to_string()),
                }),
                subject: Some("HVAC broken on floor 3".to_string()),
                text_body: Some("Conference room is too hot".to_string()),
                html_body: None,
                message_id: Some("abc-123".to_string()),
                idempotency_key: None,
            })
            .to_request();

        let response: PostmarkWebhookResponse = test::call_and_read_body_json(&app, request).await;

        assert_eq!(response.inbox_item.source, "postmark:alerts@example.com");
        assert!(response.inbox_item.content.contains("HVAC broken"));
        assert_eq!(response.work_item.title, "Maintenance Request");
        assert_eq!(response.work_item.recommended_actions.len(), 3);

        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;

        let work_req = test::TestRequest::get().uri("/work").to_request();
        let work: Vec<WorkItem> = test::call_and_read_body_json(&app, work_req).await;

        assert_eq!(items.len(), 1);
        assert_eq!(work.len(), 1);
        assert_eq!(items[0].status, "work_generated");
    }

    #[actix_web::test]
    async fn postmark_webhook_is_idempotent_for_same_message_key() {
        let app = test::init_service(build_app(test_state())).await;
        let payload = PostmarkInboundRequest {
            from: Some("alerts@example.com".to_string()),
            from_full: Some(PostmarkAddress {
                email: Some("alerts@example.com".to_string()),
            }),
            subject: Some("HVAC broken on floor 3".to_string()),
            text_body: Some("Conference room is too hot".to_string()),
            html_body: None,
            message_id: Some("abc-123".to_string()),
            idempotency_key: None,
        };

        let first_req = test::TestRequest::post()
            .uri("/webhooks/postmark")
            .set_json(&payload)
            .to_request();
        let first: PostmarkWebhookResponse = test::call_and_read_body_json(&app, first_req).await;

        let second_req = test::TestRequest::post()
            .uri("/webhooks/postmark")
            .set_json(&payload)
            .to_request();
        let second_resp = test::call_service(&app, second_req).await;
        assert_eq!(second_resp.status(), StatusCode::OK);
        let second: PostmarkWebhookResponse = test::read_body_json(second_resp).await;

        assert_eq!(first.inbox_item.id, second.inbox_item.id);
        assert_eq!(first.work_item.id, second.work_item.id);

        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;
        assert_eq!(items.len(), 1);
    }

    #[actix_web::test]
    async fn signal_ingest_normalizes_webhook_payloads() {
        let app = test::init_service(build_app(test_state())).await;

        let request = test::TestRequest::post()
            .uri("/signals")
            .set_json(&serde_json::json!({
                "sourceType": "webhook",
                "rawPayload": {
                    "text": "Payment failed for invoice #991"
                },
                "metadata": {
                    "sender": "billing-system",
                    "channel": "stripe",
                    "timestamp": 1720000000
                }
            }))
            .to_request();

        let inbox_item: InboxItem = test::call_and_read_body_json(&app, request).await;
        assert_eq!(inbox_item.source, "webhook");
        assert_eq!(inbox_item.content, "Payment failed for invoice #991");

        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content, "Payment failed for invoice #991");
    }

    #[actix_web::test]
    async fn timeline_endpoint_returns_lifecycle_events_in_order() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&IngestRequest {
                source: "email".to_string(),
                content: "HVAC is broken".to_string(),
                tenant_id: None,
            })
            .to_request();

        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();

        let _work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let timeline_req = test::TestRequest::get()
            .uri(&format!("/items/{}/timeline", inbox_item.id))
            .to_request();
        let timeline: Vec<IngressTimelineEntry> =
            test::call_and_read_body_json(&app, timeline_req).await;

        let event_types: Vec<String> = timeline
            .iter()
            .map(|event| event.entry_type.clone())
            .collect();
        assert_eq!(
            event_types,
            vec![
                "received".to_string(),
                "classified".to_string(),
                "recommendations_generated".to_string(),
                "work_generated".to_string()
            ]
        );
    }

    #[actix_web::test]
    async fn action_selection_and_outcome_close_the_work_loop() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in suite 201",
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let select_action_req = test::TestRequest::post()
            .uri(&format!("/work/{}/selection", work_item.id))
            .set_json(&serde_json::json!({
                "systemAction": "Inspect HVAC Unit",
                "tenantAction": "Inspect HVAC Unit",
            }))
            .to_request();
        let selection: ActionSelection =
            test::call_and_read_body_json(&app, select_action_req).await;
        assert_eq!(selection.work_item_id, work_item.id);
        assert_eq!(selection.system_action, "Inspect HVAC Unit");

        let record_outcome_req = test::TestRequest::post()
            .uri(&format!("/work/{}/outcome", work_item.id))
            .set_json(&serde_json::json!({
                "selectedActionId": "Inspect HVAC Unit",
                "status": "completed",
                "feedback": "correct",
                "resolutionNotes": "Resolved after onsite repair"
            }))
            .to_request();
        let outcome: WorkOutcome = test::call_and_read_body_json(&app, record_outcome_req).await;
        assert_eq!(outcome.status, "completed");
        assert_eq!(outcome.feedback.as_deref(), Some("correct"));

        let work_req = test::TestRequest::get().uri("/work").to_request();
        let work: Vec<WorkItem> = test::call_and_read_body_json(&app, work_req).await;
        assert_eq!(work[0].status, "completed");

        let timeline_req = test::TestRequest::get()
            .uri(&format!("/items/{}/timeline", inbox_item.id))
            .to_request();
        let timeline: Vec<IngressTimelineEntry> =
            test::call_and_read_body_json(&app, timeline_req).await;
        let event_types: Vec<String> = timeline
            .iter()
            .map(|event| event.entry_type.clone())
            .collect();
        assert!(event_types.iter().any(|entry| entry == "action_selected"));
        assert!(event_types.iter().any(|entry| entry == "closed"));
    }

    #[actix_web::test]
    async fn outcome_rejects_invalid_status() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in suite 201",
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let record_outcome_req = test::TestRequest::post()
            .uri(&format!("/work/{}/outcome", work_item.id))
            .set_json(&serde_json::json!({
                "status": "open",
                "feedback": "correct"
            }))
            .to_request();
        let response = test::call_service(&app, record_outcome_req).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[actix_web::test]
    async fn tenant_actions_are_used_for_recommendations() {
        let app = test::init_service(build_app(test_state())).await;

        let create_action_req = test::TestRequest::post()
            .uri("/actions")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "name": "Create Service Ticket",
                "description": "Create ticket in tenant maintenance system.",
                "category": "maintenance",
                "classificationTypes": ["maintenance_request"],
                "active": true
            }))
            .to_request();
        let _: ActionDefinition = test::call_and_read_body_json(&app, create_action_req).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC on floor 5 is down",
                "tenantId": "acme"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        assert_eq!(work_item.tenant_id, "acme");
        assert_eq!(work_item.classification_type, "maintenance_request");
        assert_eq!(work_item.recommended_actions.len(), 1);
        assert_eq!(
            work_item.recommended_actions[0].title,
            "Create Service Ticket"
        );
    }

    #[actix_web::test]
    async fn creating_tenant_provisions_default_actions() {
        let app = test::init_service(build_app(test_state())).await;

        let create_tenant_req = test::TestRequest::post()
            .uri("/tenants")
            .set_json(&serde_json::json!({
                "name": "Acme Property Management",
                "subdomain": "acme",
                "vertical": "Property Management",
                "industry": "Commercial Real Estate"
            }))
            .to_request();
        let tenant: Tenant = test::call_and_read_body_json(&app, create_tenant_req).await;

        let actions_req = test::TestRequest::get()
            .uri(&format!("/actions?tenantId={}", tenant.id))
            .to_request();
        let actions: Vec<ActionDefinition> = test::call_and_read_body_json(&app, actions_req).await;

        assert!(!actions.is_empty());
        assert_eq!(tenant.slug, "acme");
        assert_eq!(tenant.domain, "acme.canonflo.com");
        assert!(
            actions
                .iter()
                .any(|action| action.name == "Dispatch Maintenance Vendor")
        );
        assert!(
            actions
                .iter()
                .any(|action| action.name == "Dispatch Maintenance Vendor"
                    && action.assigned_org_unit_id != Uuid::nil())
        );
    }

    #[actix_web::test]
    async fn creating_tenant_accepts_signup_payload_shape() {
        let app = test::init_service(build_app(test_state())).await;

        let create_tenant_req = test::TestRequest::post()
            .uri("/tenants")
            .set_json(&serde_json::json!({
                "tenantName": "River Clinic",
                "subdomain": "river-clinic"
            }))
            .to_request();
        let tenant: Tenant = test::call_and_read_body_json(&app, create_tenant_req).await;

        assert_eq!(tenant.name, "River Clinic");
        assert_eq!(tenant.slug, "river_clinic");
        assert_eq!(tenant.domain, "river_clinic.canonflo.com");
    }

    #[actix_web::test]
    async fn creating_tenant_requires_subdomain_or_slug() {
        let app = test::init_service(build_app(test_state())).await;

        let create_tenant_req = test::TestRequest::post()
            .uri("/tenants")
            .set_json(&serde_json::json!({
                "name": "Missing Subdomain Tenant"
            }))
            .to_request();
        let response = test::call_service(&app, create_tenant_req).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[actix_web::test]
    async fn creating_tenant_seeds_onboarding_signals_and_work_items() {
        let app = test::init_service(build_app(test_state())).await;

        let create_tenant_req = test::TestRequest::post()
            .uri("/tenants")
            .set_json(&serde_json::json!({
                "name": "Acme Property Management",
                "subdomain": "acme-live",
                "vertical": "Property Management",
                "industry": "Commercial Real Estate"
            }))
            .to_request();
        let tenant: Tenant = test::call_and_read_body_json(&app, create_tenant_req).await;

        let items_req = test::TestRequest::get()
            .uri(&format!("/items?tenantId={}", tenant.id))
            .to_request();
        let inbox_items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;

        let work_req = test::TestRequest::get()
            .uri(&format!("/work?tenantId={}", tenant.id))
            .to_request();
        let work_items: Vec<WorkItem> = test::call_and_read_body_json(&app, work_req).await;

        assert!(!inbox_items.is_empty());
        assert!(!work_items.is_empty());
        assert!(
            inbox_items
                .iter()
                .all(|item| item.source.eq_ignore_ascii_case("simulation"))
        );
        assert!(
            inbox_items
                .iter()
                .all(|item| item.status == "work_generated")
        );
    }

    #[actix_web::test]
    async fn falls_back_to_pack_actions_when_tenant_action_catalog_is_empty() {
        let app_state = test_state();
        {
            let mut state = lock_state(&app_state);
            state.tenants.push(Tenant {
                id: "clinic-tenant".to_string(),
                slug: "clinic-tenant".to_string(),
                domain: "clinic-tenant.canonflo.com".to_string(),
                name: "Clinic Tenant".to_string(),
                display_name: "Clinic Tenant".to_string(),
                vertical: "Healthcare".to_string(),
                industry: "Clinic".to_string(),
                created_at: Utc::now().timestamp(),
            });
        }
        let app = test::init_service(build_app(app_state)).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "Please schedule an appointment for tomorrow",
                "tenantId": "clinic-tenant"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        assert_eq!(work_item.classification_type, "scheduling_request");
        assert!(
            work_item
                .recommended_actions
                .iter()
                .any(|action| action.title == "Schedule Appointment")
        );
    }

    #[actix_web::test]
    async fn org_units_and_routing_preview_endpoints_return_routing_context() {
        let app = test::init_service(build_app(test_state())).await;

        let org_units_req = test::TestRequest::get()
            .uri("/org/units?tenantId=default")
            .to_request();
        let org_units: Vec<OrgUnit> = test::call_and_read_body_json(&app, org_units_req).await;
        assert!(!org_units.is_empty());

        let preview_req = test::TestRequest::get()
            .uri("/work/routing-preview?tenantId=default&classificationType=maintenance_request")
            .to_request();
        let preview: WorkRoutingPreview = test::call_and_read_body_json(&app, preview_req).await;
        assert_eq!(preview.classification_type, "maintenance_request");
        assert!(preview.assigned_org_unit.is_some());
        assert!(!preview.routing_path.is_empty());
    }

    #[actix_web::test]
    async fn business_rules_modify_routing_priority_and_execution_requirements() {
        let app = test::init_service(build_app(test_state())).await;

        let org_units_req = test::TestRequest::get()
            .uri("/org/units?tenantId=default")
            .to_request();
        let org_units: Vec<OrgUnit> = test::call_and_read_body_json(&app, org_units_req).await;
        let maintenance_org_unit_id = org_units
            .iter()
            .find(|org_unit| org_unit.name.eq_ignore_ascii_case("maintenance"))
            .map(|org_unit| org_unit.id)
            .expect("maintenance org unit should exist");

        let create_org_unit_req = test::TestRequest::post()
            .uri("/org/units")
            .set_json(&serde_json::json!({
                "tenantId": "default",
                "name": "Regional Manager",
                "type": "role"
            }))
            .to_request();
        let regional_manager: OrgUnit =
            test::call_and_read_body_json(&app, create_org_unit_req).await;

        let create_priority_rule_req = test::TestRequest::post()
            .uri("/business-rules")
            .set_json(&serde_json::json!({
                "tenantId": "default",
                "title": "No heat is high priority",
                "ruleText": "If \"no heat\" then set priority = HIGH",
                "scope": "priority",
                "priority": 900
            }))
            .to_request();
        let _: BusinessRule = test::call_and_read_body_json(&app, create_priority_rule_req).await;

        let create_routing_rule_req = test::TestRequest::post()
            .uri("/business-rules")
            .set_json(&serde_json::json!({
                "tenantId": "default",
                "title": "Route no heat incidents to regional manager",
                "ruleText": "If \"no heat\" route to Regional Manager",
                "scope": "routing",
                "priority": 800
            }))
            .to_request();
        let _: BusinessRule = test::call_and_read_body_json(&app, create_routing_rule_req).await;

        let create_execution_rule_req = test::TestRequest::post()
            .uri("/business-rules")
            .set_json(&serde_json::json!({
                "tenantId": "default",
                "title": "Maintenance items require approval",
                "ruleText": "If \"no heat\" then require approval",
                "scope": "execution",
                "priority": 700
            }))
            .to_request();
        let _: BusinessRule = test::call_and_read_body_json(&app, create_execution_rule_req).await;
        let create_scoped_rule_req = test::TestRequest::post()
            .uri("/business-rules")
            .set_json(&serde_json::json!({
                "tenantId": "default",
                "orgUnitId": maintenance_org_unit_id,
                "title": "Maintenance scoped routing note",
                "ruleText": "If \"hvac\" route to Operations",
                "scope": "routing",
                "priority": 600
            }))
            .to_request();
        let scoped_rule: BusinessRule =
            test::call_and_read_body_json(&app, create_scoped_rule_req).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "Tenant reports no heat in conference room",
                "tenantId": "default"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        assert_eq!(work_item.priority, "high");
        assert_eq!(work_item.assigned_org_unit_id, regional_manager.id);
        assert!(work_item.require_approval);
        assert!(!work_item.applied_rules.is_empty());

        let scoped_rules_req = test::TestRequest::get()
            .uri(&format!(
                "/business-rules?tenantId=default&orgUnitId={}",
                maintenance_org_unit_id
            ))
            .to_request();
        let scoped_rules: Vec<BusinessRule> =
            test::call_and_read_body_json(&app, scoped_rules_req).await;
        assert!(scoped_rules.iter().any(|rule| rule.id == scoped_rule.id));
    }

    #[actix_web::test]
    async fn vault_keys_are_tenant_scoped_and_not_exposed_in_plaintext() {
        let app_state = test_state();
        let app = test::init_service(build_app(app_state.clone())).await;

        let create_secret_req = test::TestRequest::post()
            .uri("/vault/keys")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "provider": "slack",
                "keyName": "slack_bot_token",
                "value": "xoxb-secret"
            }))
            .to_request();
        let summary: TenantSecretSummary =
            test::call_and_read_body_json(&app, create_secret_req).await;
        assert_eq!(summary.tenant_id, "acme");
        assert_eq!(summary.key_name, "slack_bot_token");

        let list_req = test::TestRequest::get()
            .uri("/vault/keys?tenantId=acme")
            .to_request();
        let keys: Vec<TenantSecretSummary> = test::call_and_read_body_json(&app, list_req).await;
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].provider, "slack");

        let other_tenant_req = test::TestRequest::get()
            .uri("/vault/keys?tenantId=other")
            .to_request();
        let other_keys: Vec<TenantSecretSummary> =
            test::call_and_read_body_json(&app, other_tenant_req).await;
        assert!(other_keys.is_empty());

        let state = lock_state(&app_state);
        let stored = state
            .tenant_secrets
            .iter()
            .find(|secret| secret.tenant_id == "acme")
            .expect("secret should be stored");
        assert_ne!(stored.encrypted_value, "xoxb-secret");
        drop(state);

        let events = app_state.event_bus.drain();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, domain::events::DomainEvent::VaultKeyUpdated { tenant_id, .. } if tenant_id == "acme"))
        );
    }

    #[actix_web::test]
    async fn execute_action_uses_tenant_vault_credentials_and_tracks_execution() {
        let app_state = test_state();
        let app = test::init_service(build_app(app_state.clone())).await;

        let create_action_req = test::TestRequest::post()
            .uri("/actions")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "name": "Notify Maintenance Team",
                "description": "Send Slack alert",
                "category": "notification",
                "classificationTypes": ["maintenance_request"],
                "executionProvider": "slack",
                "active": true
            }))
            .to_request();
        let action: ActionDefinition = test::call_and_read_body_json(&app, create_action_req).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in Room A",
                "tenantId": "acme"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let create_secret_req = test::TestRequest::post()
            .uri("/vault/keys")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "provider": "slack",
                "keyName": "slack_bot_token",
                "value": "xoxb-secret"
            }))
            .to_request();
        let _: TenantSecretSummary = test::call_and_read_body_json(&app, create_secret_req).await;

        let execute_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "workItemId": work_item.id,
                "actionId": action.id,
                "payload": {
                    "channel": "#maintenance",
                    "message": "HVAC issue in Room A"
                }
            }))
            .to_request();
        let execution: ExecutionResultRecord =
            test::call_and_read_body_json(&app, execute_req).await;
        assert_eq!(execution.tenant_id, "acme");
        assert_eq!(execution.provider, "slack");
        assert_eq!(execution.status, "success");
        assert_eq!(execution.execution_type, "external_signal");
        assert_eq!(execution.result_type, "external_api_call");
        assert!(!execution.side_effects.is_empty());
        assert!(execution.context_snapshot.is_object());
        assert!(execution.executed_at.is_some());

        let execution_lookup_req = test::TestRequest::get()
            .uri(&format!("/executions/{}?tenantId=acme", execution.id))
            .to_request();
        let fetched: ExecutionResultRecord =
            test::call_and_read_body_json(&app, execution_lookup_req).await;
        assert_eq!(fetched.id, execution.id);

        let events = app_state.event_bus.drain();
        assert!(events.iter().any(|event| {
            matches!(
                event,
                domain::events::DomainEvent::ActionExecuted {
                    tenant_id,
                    execution_id,
                    action_id,
                    result,
                } if tenant_id == "acme"
                    && execution_id == &execution.id.to_string()
                    && action_id == &action.id.to_string()
                    && result == "success"
            )
        }));
    }

    #[actix_web::test]
    async fn execute_action_is_idempotent_with_same_key() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in Room A",
                "tenantId": "acme"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let create_action_req = test::TestRequest::post()
            .uri("/actions")
            .set_json(&serde_json::json!({
                "tenantId": "acme",
                "name": "Idempotent Action",
                "description": "Test action",
                "category": "update",
                "classificationTypes": ["maintenance_request"],
                "executionProvider": "internal",
                "active": true
            }))
            .to_request();
        let action: ActionDefinition = test::call_and_read_body_json(&app, create_action_req).await;

        let execute_payload = serde_json::json!({
            "tenantId": "acme",
            "workItemId": work_item.id,
            "actionId": action.id,
            "provider": "internal",
            "idempotencyKey": "exec-1",
            "payload": { "note": "run-once" }
        });
        let first_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&execute_payload)
            .to_request();
        let first: ExecutionResultRecord = test::call_and_read_body_json(&app, first_req).await;

        let second_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&execute_payload)
            .to_request();
        let second_resp = test::call_service(&app, second_req).await;
        assert_eq!(second_resp.status(), StatusCode::OK);
        let second: ExecutionResultRecord = test::read_body_json(second_resp).await;

        assert_eq!(first.id, second.id);

        let list_req = test::TestRequest::get()
            .uri("/executions?tenantId=acme")
            .to_request();
        let executions: Vec<ExecutionResultRecord> =
            test::call_and_read_body_json(&app, list_req).await;
        assert_eq!(executions.len(), 1);
    }

    #[actix_web::test]
    async fn behavioral_patterns_endpoint_infers_operational_truth_layer() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in Room A"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let select_action_req = test::TestRequest::post()
            .uri(&format!("/work/{}/selection", work_item.id))
            .set_json(&serde_json::json!({
                "systemAction": "Inspect HVAC Unit",
                "tenantAction": "Dispatch Maintenance Vendor"
            }))
            .to_request();
        let _: ActionSelection = test::call_and_read_body_json(&app, select_action_req).await;

        let execute_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&serde_json::json!({
                "workItemId": work_item.id,
                "actionName": "Dispatch Maintenance Vendor",
                "provider": "slack"
            }))
            .to_request();
        let _: ExecutionResultRecord = test::call_and_read_body_json(&app, execute_req).await;

        let patterns_req = test::TestRequest::get()
            .uri("/behavioral-patterns?tenantId=default")
            .to_request();
        let patterns: Vec<BehavioralPattern> =
            test::call_and_read_body_json(&app, patterns_req).await;

        assert!(
            patterns
                .iter()
                .any(|pattern| pattern.pattern_type == "action_drift")
        );
        assert!(
            patterns
                .iter()
                .any(|pattern| pattern.pattern_type == "bypass_behavior")
        );
    }

    #[actix_web::test]
    async fn process_graph_endpoint_reconstructs_as_is_flow_and_drift() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in Room A"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let select_action_req = test::TestRequest::post()
            .uri(&format!("/work/{}/selection", work_item.id))
            .set_json(&serde_json::json!({
                "systemAction": "Inspect HVAC Unit",
                "tenantAction": "Dispatch Maintenance Vendor"
            }))
            .to_request();
        let _: ActionSelection = test::call_and_read_body_json(&app, select_action_req).await;

        let execute_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&serde_json::json!({
                "workItemId": work_item.id,
                "actionName": "Dispatch Maintenance Vendor",
                "provider": "slack"
            }))
            .to_request();
        let _: ExecutionResultRecord = test::call_and_read_body_json(&app, execute_req).await;

        let graph_req = test::TestRequest::get()
            .uri("/process-graph?tenantId=default")
            .to_request();
        let graph: ProcessGraph = test::call_and_read_body_json(&app, graph_req).await;

        assert_eq!(
            graph.designed_process,
            vec![
                "Intake".to_string(),
                "Assign Maintenance".to_string(),
                "Resolve".to_string(),
                "Close".to_string()
            ]
        );
        assert!(
            graph.process_nodes.iter().any(|node| node.name == "Intake")
                && graph
                    .process_nodes
                    .iter()
                    .any(|node| node.name == "Maintenance Review")
        );
        assert!(
            graph
                .process_edges
                .iter()
                .any(|edge| edge.transition_type == "bypass")
        );
        assert!(
            graph
                .process_edges
                .iter()
                .any(|edge| edge.transition_type == "external")
        );
        assert!(graph.drift_score > 0.0);
    }

    #[actix_web::test]
    async fn operational_artifacts_endpoint_generates_policy_ready_documents() {
        let app = test::init_service(build_app(test_state())).await;

        let ingest_req = test::TestRequest::post()
            .uri("/ingest")
            .set_json(&serde_json::json!({
                "source": "email",
                "content": "HVAC issue in Room A"
            }))
            .to_request();
        let inbox_item: InboxItem = test::call_and_read_body_json(&app, ingest_req).await;

        let extract_req = test::TestRequest::post()
            .uri("/extract")
            .set_json(&ExtractRequest {
                inbox_item_id: inbox_item.id,
            })
            .to_request();
        let work_item: WorkItem = test::call_and_read_body_json(&app, extract_req).await;

        let select_action_req = test::TestRequest::post()
            .uri(&format!("/work/{}/selection", work_item.id))
            .set_json(&serde_json::json!({
                "systemAction": "Inspect HVAC Unit",
                "tenantAction": "Dispatch Maintenance Vendor"
            }))
            .to_request();
        let _: ActionSelection = test::call_and_read_body_json(&app, select_action_req).await;

        let execute_req = test::TestRequest::post()
            .uri("/actions/execute")
            .set_json(&serde_json::json!({
                "workItemId": work_item.id,
                "actionName": "Dispatch Maintenance Vendor",
                "provider": "slack"
            }))
            .to_request();
        let _: ExecutionResultRecord = test::call_and_read_body_json(&app, execute_req).await;

        let artifacts_req = test::TestRequest::get()
            .uri("/operational-artifacts?tenantId=default")
            .to_request();
        let artifacts: Vec<OperationalArtifact> =
            test::call_and_read_body_json(&app, artifacts_req).await;

        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.artifact_type == "process_map")
        );
        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.artifact_type == "SOP")
        );
        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.artifact_type == "policy")
        );
        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.artifact_type == "decision_tree")
        );
        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.artifact_type == "swimlane")
        );
        assert!(artifacts.iter().all(|artifact| artifact.version == 1));
        assert!(
            artifacts
                .iter()
                .any(|artifact| artifact.derived_from.contains(&"process_edges".to_string()))
        );

        let policy_artifacts_req = test::TestRequest::get()
            .uri("/operational-artifacts?tenantId=default&type=policy&q=vendor")
            .to_request();
        let policy_artifacts: Vec<OperationalArtifact> =
            test::call_and_read_body_json(&app, policy_artifacts_req).await;
        assert_eq!(policy_artifacts.len(), 1);
    }
}
