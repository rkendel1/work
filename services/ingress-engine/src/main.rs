use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboxItem {
    id: Uuid,
    source: String,
    received_at: DateTime<Utc>,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkItem {
    id: Uuid,
    inbox_item_id: Uuid,
    title: String,
    summary: String,
    status: String,
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

fn classify_content(content: &str) -> (&'static str, &'static str) {
    let lower = content.to_lowercase();

    if contains_any(
        &lower,
        &["hvac", "broken", "down", "not working", "repair", "issue"],
    ) {
        (
            "Maintenance Request",
            "Operational maintenance issue requiring inspection and follow-up.",
        )
    } else if contains_any(&lower, &["invoice", "payment"]) {
        (
            "Finance Inquiry",
            "Financial question detected from incoming operational information.",
        )
    } else if contains_any(&lower, &["schedule", "appointment"]) {
        (
            "Scheduling Request",
            "Scheduling-related request detected and ready for action.",
        )
    } else {
        (
            "Operational Request",
            "General operational request extracted from incoming information.",
        )
    }
}

fn create_inbox_item(state: &mut State, source: String, content: String) -> InboxItem {
    let item = InboxItem {
        id: Uuid::new_v4(),
        source,
        received_at: Utc::now(),
        content,
    };

    state.inbox_items.push(item.clone());
    item
}

fn create_work_item(state: &mut State, inbox_item: &InboxItem) -> WorkItem {
    let (title, summary) = classify_content(&inbox_item.content);
    let work_item = WorkItem {
        id: Uuid::new_v4(),
        inbox_item_id: inbox_item.id,
        title: title.to_string(),
        summary: summary.to_string(),
        status: "open".to_string(),
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
struct ConvexInboxArgs {
    external_id: String,
    source: String,
    received_at: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ConvexWorkArgs {
    external_id: String,
    inbox_external_id: String,
    title: String,
    summary: String,
    status: String,
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
        },
    )
    .await
}

async fn ingest(data: web::Data<AppState>, request: web::Json<IngestRequest>) -> impl Responder {
    let item = {
        let mut state = lock_state(&data);
        create_inbox_item(&mut state, request.source.clone(), request.content.clone())
    };

    if let Err(error) = forward_inbox_to_convex(&data.client, &data.convex_config, &item).await {
        eprintln!("failed to forward inbox item to convex: {error}");
    }

    HttpResponse::Created().json(item)
}

async fn extract(data: web::Data<AppState>, request: web::Json<ExtractRequest>) -> impl Responder {
    let (work_item, is_new) = {
        let mut state = lock_state(&data);

        if let Some(existing) = state
            .work_items
            .iter()
            .find(|work_item| work_item.inbox_item_id == request.inbox_item_id)
            .cloned()
        {
            (existing, false)
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
            (work_item, true)
        }
    };

    if is_new {
        if let Err(error) =
            forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
        {
            eprintln!("failed to forward work item to convex: {error}");
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

    let (inbox_item, work_item) = {
        let mut state = lock_state(&data);
        let inbox_item = create_inbox_item(&mut state, source, content);
        let work_item = create_work_item(&mut state, &inbox_item);
        (inbox_item, work_item)
    };

    if let Err(error) =
        forward_inbox_to_convex(&data.client, &data.convex_config, &inbox_item).await
    {
        eprintln!("failed to forward postmark inbox item to convex: {error}");
    }

    if let Err(error) = forward_work_to_convex(&data.client, &data.convex_config, &work_item).await
    {
        eprintln!("failed to forward postmark work item to convex: {error}");
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

async fn list_work(data: web::Data<AppState>) -> impl Responder {
    let state = lock_state(&data);
    HttpResponse::Ok().json(&state.work_items)
}

fn app_config(cfg: &mut web::ServiceConfig) {
    cfg.route("/ingest", web::post().to(ingest))
        .route("/extract", web::post().to(extract))
        .route("/items", web::get().to(list_items))
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

        assert_eq!(work_item.inbox_item_id, inbox_item.id);
        assert_eq!(work_item.title, "Maintenance Request");
        assert_eq!(work_item.status, "open");
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
        assert_eq!(work[0].title, "Finance Inquiry");
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

        let items_req = test::TestRequest::get().uri("/items").to_request();
        let items: Vec<InboxItem> = test::call_and_read_body_json(&app, items_req).await;

        let work_req = test::TestRequest::get().uri("/work").to_request();
        let work: Vec<WorkItem> = test::call_and_read_body_json(&app, work_req).await;

        assert_eq!(items.len(), 1);
        assert_eq!(work.len(), 1);
    }
}
