use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use chrono::{DateTime, Utc};
use recommendation_engine::{
    ActionType, ClassificationResult, Entity as ClassificationEntity, RecommendationGenerator,
    RecommendedAction, RuleBasedRecommendationEngine,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

mod recommendation_engine;

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
    status: String,
    recommended_actions: Vec<RecommendedAction>,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IngestRequest {
    source: String,
    content: String,
    tenant_id: Option<String>,
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
    display_name: String,
    vertical: String,
    industry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActionDefinition {
    id: Uuid,
    tenant_id: String,
    name: String,
    description: String,
    category: String,
    classification_types: Vec<String>,
    active: bool,
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
    name: String,
    vertical: String,
    industry: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateActionRequest {
    tenant_id: Option<String>,
    name: String,
    description: String,
    category: String,
    classification_types: Vec<String>,
    active: Option<bool>,
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

struct State {
    inbox_items: Vec<InboxItem>,
    ingress_events: Vec<IngressEvent>,
    work_items: Vec<WorkItem>,
    tenants: Vec<Tenant>,
    actions: Vec<ActionDefinition>,
    classifications: Vec<ClassificationDefinition>,
    action_selections: Vec<ActionSelection>,
    work_outcomes: Vec<WorkOutcome>,
}

const DEFAULT_TENANT_ID: &str = "default";
const DEFAULT_TENANT_SLUG: &str = "default";
const DEFAULT_TENANT_NAME: &str = "Default Tenant";

impl Default for State {
    fn default() -> Self {
        let default_tenant = Tenant {
            id: DEFAULT_TENANT_ID.to_string(),
            slug: DEFAULT_TENANT_SLUG.to_string(),
            display_name: DEFAULT_TENANT_NAME.to_string(),
            vertical: "Property Management".to_string(),
            industry: "Commercial Real Estate".to_string(),
        };
        let default_pack = load_pack("Property Management", "Commercial Real Estate");
        let actions = actions_from_pack(&default_tenant.id, &default_pack);
        let classifications = classifications_from_pack(&default_tenant.id, &default_pack);

        Self {
            inbox_items: Vec::new(),
            ingress_events: Vec::new(),
            work_items: Vec::new(),
            tenants: vec![default_tenant],
            actions,
            classifications,
            action_selections: Vec::new(),
            work_outcomes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct ConvexConfig {
    deployment_url: Option<String>,
    admin_key: Option<String>,
}

struct AppState {
    state: Mutex<State>,
    convex_config: ConvexConfig,
    client: Client,
}

impl AppState {
    fn new(convex_config: ConvexConfig) -> Self {
        Self {
            state: Mutex::new(State::default()),
            convex_config,
            client: Client::new(),
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

fn actions_from_pack(tenant_id: &str, pack: &OperationalPack) -> Vec<ActionDefinition> {
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
            active: true,
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

fn ensure_tenant_exists(state: &mut State, tenant_id: &str) {
    if state.tenants.iter().any(|tenant| tenant.id == tenant_id) {
        return;
    }

    let tenant = Tenant {
        id: tenant_id.to_string(),
        slug: normalize_identifier(tenant_id),
        display_name: tenant_id.to_string(),
        vertical: "General".to_string(),
        industry: "General".to_string(),
    };
    state.tenants.push(tenant);
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
    actions_from_pack(tenant_id, &pack)
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
    let work_item = WorkItem {
        id: Uuid::new_v4(),
        tenant_id: inbox_item.tenant_id.clone(),
        inbox_item_id: inbox_item.id,
        classification_type: classification_result.classification.clone(),
        title: classification_title(&classification_result.classification).to_string(),
        summary: classification_result.reason.clone(),
        status: "open".to_string(),
        recommended_actions: classification_result.recommendations.clone(),
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
struct ConvexWorkArgs {
    tenant_id: String,
    external_id: String,
    inbox_external_id: String,
    classification_type: String,
    title: String,
    summary: String,
    status: String,
    recommended_actions: Vec<ConvexRecommendedAction>,
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
    slug: String,
    display_name: String,
    vertical: String,
    industry: String,
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
            recommended_actions: work_item
                .recommended_actions
                .iter()
                .map(|action| ConvexRecommendedAction {
                    title: action.title.clone(),
                    description: action.description.clone(),
                    action_type: action.action_type.as_str().to_string(),
                })
                .collect(),
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
            completed_at: outcome.completed_at.map(|completed_at| completed_at.timestamp()),
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
            slug: tenant.slug.clone(),
            display_name: tenant.display_name.clone(),
            vertical: tenant.vertical.clone(),
            industry: tenant.industry.clone(),
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

async fn ingest(data: web::Data<AppState>, request: web::Json<IngestRequest>) -> impl Responder {
    let (item, received_event) = {
        let mut state = lock_state(&data);
        let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
        ensure_tenant_exists(&mut state, &tenant_id);
        let item = create_inbox_item(
            &mut state,
            tenant_id,
            request.source.clone(),
            request.content.clone(),
        );
        let received_event = state.ingress_events.last().cloned();
        (item, received_event)
    };

    if let Err(error) = forward_inbox_to_convex(&data.client, &data.convex_config, &item).await {
        eprintln!("failed to forward inbox item to convex: {error}");
    }
    if let Some(event) = received_event {
        if let Err(error) =
            forward_ingress_event_to_convex(&data.client, &data.convex_config, item.id, &event)
                .await
        {
            eprintln!("failed to forward ingress event to convex: {error}");
        }
    }

    HttpResponse::Created().json(item)
}

async fn extract(data: web::Data<AppState>, request: web::Json<ExtractRequest>) -> impl Responder {
    let (work_item, is_new, status_updates, recommendation_events) = {
        let mut state = lock_state(&data);

        if let Some(existing) = state
            .work_items
            .iter()
            .find(|work_item| work_item.inbox_item_id == request.inbox_item_id)
            .cloned()
        {
            (existing, false, Vec::new(), Vec::new())
        } else {
            let Some(inbox_item) = state
                .inbox_items
                .iter()
                .find(|item| item.id == request.inbox_item_id)
                .cloned()
            else {
                return HttpResponse::NotFound().body("inbox item not found");
            };

            let work_item = create_work_item(&mut state, &inbox_item);
            let mut status_updates = Vec::new();
            if let Some(classified_event) = update_ingress_status(
                &mut state,
                inbox_item.id,
                "classified",
                format!("Classification: {}", work_item.title),
            ) {
                status_updates.push((inbox_item.id, classified_event));
            }
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
            let recommendation_events = vec![(inbox_item.id, recommendations_event)];
            if let Some(work_generated_event) = update_ingress_status(
                &mut state,
                inbox_item.id,
                "work_generated",
                format!("Created Work Item {}", work_item.id),
            ) {
                status_updates.push((inbox_item.id, work_generated_event));
            }

            (work_item, true, status_updates, recommendation_events)
        }
    };

    if is_new {
        if let Err(error) =
            forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
        {
            eprintln!("failed to forward work item to convex: {error}");
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
    let content = build_postmark_content(&payload);
    let source = postmark_source(&payload);

    let (inbox_item, work_item, status_updates, received_event, recommendations_event) = {
        let mut state = lock_state(&data);
        let tenant_id = DEFAULT_TENANT_ID.to_string();
        ensure_tenant_exists(&mut state, &tenant_id);
        let inbox_item = create_inbox_item(&mut state, tenant_id, source, content);
        let work_item = create_work_item(&mut state, &inbox_item);
        let mut status_updates = Vec::new();
        if let Some(classified_event) = update_ingress_status(
            &mut state,
            inbox_item.id,
            "classified",
            format!("Classification: {}", work_item.title),
        ) {
            status_updates.push((inbox_item.id, classified_event));
        }
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
        if let Some(work_generated_event) = update_ingress_status(
            &mut state,
            inbox_item.id,
            "work_generated",
            format!("Created Work Item {}", work_item.id),
        ) {
            status_updates.push((inbox_item.id, work_generated_event));
        }
        let received_event = state
            .ingress_events
            .iter()
            .find(|event| event.ingress_id == inbox_item.id && event.event_type == "received")
            .cloned();
        (
            inbox_item,
            work_item,
            status_updates,
            received_event,
            recommendations_event,
        )
    };

    if let Err(error) =
        forward_inbox_to_convex(&data.client, &data.convex_config, &inbox_item).await
    {
        eprintln!("failed to forward postmark inbox item to convex: {error}");
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
    }

    if let Err(error) = forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
    {
        eprintln!("failed to forward postmark work item to convex: {error}");
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
        }
    }

    HttpResponse::Created().json(PostmarkWebhookResponse {
        inbox_item,
        work_item,
    })
}

async fn create_tenant(
    data: web::Data<AppState>,
    request: web::Json<CreateTenantRequest>,
) -> impl Responder {
    let name = request.name.trim();
    let vertical = request.vertical.trim();
    let industry = request.industry.trim();
    if name.is_empty() || vertical.is_empty() || industry.is_empty() {
        return HttpResponse::BadRequest().body("name, vertical, and industry are required");
    }

    let mut state = lock_state(&data);
    let mut slug = normalize_identifier(name);
    if slug.is_empty() {
        slug = format!("tenant_{}", Uuid::new_v4().simple());
    }
    let mut id = slug.clone();
    if state.tenants.iter().any(|tenant| tenant.id == id) {
        id = format!("{id}_{}", Uuid::new_v4().simple());
    }

    let pack = load_pack(vertical, industry);
    let tenant = Tenant {
        id: id.clone(),
        slug,
        display_name: name.to_string(),
        vertical: pack.vertical.to_string(),
        industry: pack.industry.to_string(),
    };
    state.tenants.push(tenant.clone());
    state.actions.extend(actions_from_pack(&id, &pack));
    state
        .classifications
        .extend(classifications_from_pack(&id, &pack));
    drop(state);

    forward_tenant_bootstrap_to_convex(&data.client, &data.convex_config, &tenant).await;
    HttpResponse::Created().json(tenant)
}

async fn list_tenants(data: web::Data<AppState>) -> impl Responder {
    let state = lock_state(&data);
    HttpResponse::Ok().json(&state.tenants)
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
        active: request.active.unwrap_or(true),
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
    let state = lock_state(&data);
    let mut actions: Vec<ActionDefinition> = state
        .actions
        .iter()
        .filter(|action| action.tenant_id == tenant_id)
        .filter(|action| {
            if let Some(classification_type) = &classification_type {
                action
                    .classification_types
                    .iter()
                    .any(|item| item == classification_type)
            } else {
                true
            }
        })
        .cloned()
        .collect();

    if actions.is_empty() {
        if let Some(tenant) = state.tenants.iter().find(|tenant| tenant.id == tenant_id) {
            let pack = load_pack(&tenant.vertical, &tenant.industry);
            actions = actions_from_pack(&tenant_id, &pack)
                .into_iter()
                .filter(|action| {
                    if let Some(classification_type) = &classification_type {
                        action
                            .classification_types
                            .iter()
                            .any(|item| item == classification_type)
                    } else {
                        true
                    }
                })
                .collect();
        }
    }

    HttpResponse::Ok().json(actions)
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
    let state = lock_state(&data);
    let work_items: Vec<WorkItem> = state
        .work_items
        .iter()
        .filter(|work_item| work_item.tenant_id == tenant_id)
        .cloned()
        .collect();
    HttpResponse::Ok().json(work_items)
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
        (selection, ingress_event, ingress_id)
    };

    if let Err(error) = forward_action_selection_to_convex(&data.client, &data.convex_config, &selection).await
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
        (outcome, close_event, ingress_id)
    };

    if let Err(error) = forward_work_outcome_to_convex(&data.client, &data.convex_config, &outcome).await {
        eprintln!("failed to forward work outcome to convex: {error}");
    }
    if let Some(close_event) = close_event
        && let Err(error) =
            forward_status_update_to_convex(&data.client, &data.convex_config, ingress_id, &close_event)
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

fn app_config(cfg: &mut web::ServiceConfig) {
    cfg.route("/ingest", web::post().to(ingest))
        .route("/extract", web::post().to(extract))
        .route("/tenants", web::get().to(list_tenants))
        .route("/tenants", web::post().to(create_tenant))
        .route("/actions", web::get().to(list_actions))
        .route("/actions", web::post().to(create_action))
        .route("/items", web::get().to(list_items))
        .route("/items/{id}/timeline", web::get().to(item_timeline))
        .route("/work", web::get().to(list_work))
        .route("/work/{id}/selection", web::post().to(select_work_action))
        .route("/work/{id}/outcome", web::post().to(record_work_outcome))
        .route("/webhooks/postmark", web::post().to(postmark_inbound));
}

fn load_convex_config() -> ConvexConfig {
    ConvexConfig {
        deployment_url: std::env::var("CONVEX_DEPLOYMENT_URL").ok(),
        admin_key: std::env::var("CONVEX_ADMIN_KEY").ok(),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState::new(load_convex_config()));

    HttpServer::new(move || App::new().app_data(app_state.clone()).configure(app_config))
        .bind(("127.0.0.1", 8080))?
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

    #[actix_web::test]
    async fn extract_creates_maintenance_work_item() {
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        assert_eq!(work_item.recommended_actions.len(), 3);
        assert_eq!(work_item.recommended_actions[0].title, "Inspect HVAC Unit");
        assert_eq!(items[0].status, "work_generated");
    }

    #[actix_web::test]
    async fn extract_returns_not_found_for_unknown_item() {
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
    async fn timeline_endpoint_returns_lifecycle_events_in_order() {
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

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
        let app = test::init_service(App::new().app_data(test_state()).configure(app_config)).await;

        let create_tenant_req = test::TestRequest::post()
            .uri("/tenants")
            .set_json(&serde_json::json!({
                "name": "Acme Property Management",
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
        assert!(
            actions
                .iter()
                .any(|action| action.name == "Dispatch Maintenance Vendor")
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
                display_name: "Clinic Tenant".to_string(),
                vertical: "Healthcare".to_string(),
                industry: "Clinic".to_string(),
            });
        }
        let app = test::init_service(App::new().app_data(app_state).configure(app_config)).await;

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
}
