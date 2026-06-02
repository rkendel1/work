use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use chrono::{DateTime, Utc};
use reqwest::Client;
use recommendation_engine::{
    ClassificationResult, Entity as ClassificationEntity, RecommendedAction, RecommendationGenerator,
    RuleBasedRecommendationEngine,
};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

mod recommendation_engine;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboxItem {
    id: Uuid,
    source: String,
    received_at: DateTime<Utc>,
    content: String,
    status: String,
    status_updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IngressEvent {
    ingress_id: Uuid,
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
    inbox_item_id: Uuid,
    title: String,
    summary: String,
    status: String,
    recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IngestRequest {
    source: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExtractRequest {
    inbox_item_id: Uuid,
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

#[derive(Default)]
struct State {
    inbox_items: Vec<InboxItem>,
    ingress_events: Vec<IngressEvent>,
    work_items: Vec<WorkItem>,
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

fn create_inbox_item(state: &mut State, source: String, content: String) -> InboxItem {
    let now = Utc::now();
    let item = InboxItem {
        id: Uuid::new_v4(),
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
        "received".to_string(),
        format!("Received via {}", item.source),
    );
    item
}

fn create_ingress_event(
    state: &mut State,
    ingress_id: Uuid,
    event_type: String,
    description: String,
) -> IngressEvent {
    let event = IngressEvent {
        ingress_id,
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

    inbox_item.status = new_status.clone();
    inbox_item.status_updated_at = now;
    let _ = inbox_item;

    Some(create_ingress_event(
        state,
        inbox_item_id,
        new_status,
        description,
    ))
}

fn create_work_item(state: &mut State, inbox_item: &InboxItem) -> WorkItem {
    let mut classification_result = classify_content(&inbox_item.content);
    let recommendation_engine = RuleBasedRecommendationEngine;
    classification_result.recommendations = recommendation_engine.generate(&classification_result);
    let work_item = WorkItem {
        id: Uuid::new_v4(),
        inbox_item_id: inbox_item.id,
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
    external_id: String,
    inbox_external_id: String,
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
    ingress_external_id: String,
    event_type: String,
    description: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvexUpdateIngressStatusArgs {
    ingress_external_id: String,
    status: String,
    status_updated_at: i64,
    event_type: String,
    description: String,
    created_at: i64,
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
            external_id: work_item.id.to_string(),
            inbox_external_id: work_item.inbox_item_id.to_string(),
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

async fn ingest(data: web::Data<AppState>, request: web::Json<IngestRequest>) -> impl Responder {
    let (item, received_event) = {
        let mut state = lock_state(&data);
        let item = create_inbox_item(&mut state, request.source.clone(), request.content.clone());
        let received_event = state.ingress_events.last().cloned();
        (item, received_event)
    };

    if let Err(error) = forward_inbox_to_convex(&data.client, &data.convex_config, &item).await {
        eprintln!("failed to forward inbox item to convex: {error}");
    }
    if let Some(event) = received_event {
        if let Err(error) =
            forward_ingress_event_to_convex(&data.client, &data.convex_config, item.id, &event).await
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

    let (
        inbox_item,
        work_item,
        status_updates,
        received_event,
        recommendations_event,
    ) = {
        let mut state = lock_state(&data);
        let inbox_item = create_inbox_item(&mut state, source, content);
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
        if let Err(error) =
            forward_ingress_event_to_convex(&data.client, &data.convex_config, inbox_item.id, &event)
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

async fn list_items(data: web::Data<AppState>) -> impl Responder {
    let state = lock_state(&data);
    HttpResponse::Ok().json(&state.inbox_items)
}

async fn item_timeline(data: web::Data<AppState>, inbox_item_id: web::Path<Uuid>) -> impl Responder {
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

async fn list_work(data: web::Data<AppState>) -> impl Responder {
    let state = lock_state(&data);
    HttpResponse::Ok().json(&state.work_items)
}

fn app_config(cfg: &mut web::ServiceConfig) {
    cfg.route("/ingest", web::post().to(ingest))
        .route("/extract", web::post().to(extract))
        .route("/items", web::get().to(list_items))
        .route("/items/{id}/timeline", web::get().to(item_timeline))
        .route("/work", web::get().to(list_work))
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
        assert_eq!(work_item.recommended_actions.len(), 2);
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
        assert_eq!(response.work_item.recommended_actions.len(), 2);

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
}
