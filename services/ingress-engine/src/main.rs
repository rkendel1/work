use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use chrono::{DateTime, Utc};
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

#[derive(Default)]
struct State {
    inbox_items: Vec<InboxItem>,
    work_items: Vec<WorkItem>,
}

struct AppState {
    state: Mutex<State>,
}

impl AppState {
    fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
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

async fn ingest(data: web::Data<AppState>, request: web::Json<IngestRequest>) -> impl Responder {
    let mut state = lock_state(&data);

    let item = InboxItem {
        id: Uuid::new_v4(),
        source: request.source.clone(),
        received_at: Utc::now(),
        content: request.content.clone(),
    };

    state.inbox_items.push(item.clone());

    HttpResponse::Created().json(item)
}

async fn extract(data: web::Data<AppState>, request: web::Json<ExtractRequest>) -> impl Responder {
    let mut state = lock_state(&data);

    if let Some(existing) = state
        .work_items
        .iter()
        .find(|work_item| work_item.inbox_item_id == request.inbox_item_id)
        .cloned()
    {
        return HttpResponse::Ok().json(existing);
    }

    let Some(inbox_item) = state
        .inbox_items
        .iter()
        .find(|item| item.id == request.inbox_item_id)
        .cloned()
    else {
        return HttpResponse::NotFound().body("inbox item not found");
    };

    let (title, summary) = classify_content(&inbox_item.content);

    let work_item = WorkItem {
        id: Uuid::new_v4(),
        inbox_item_id: inbox_item.id,
        title: title.to_string(),
        summary: summary.to_string(),
        status: "open".to_string(),
    };

    state.work_items.push(work_item.clone());

    HttpResponse::Created().json(work_item)
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
        .route("/work", web::get().to(list_work));
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState::new());

    HttpServer::new(move || App::new().app_data(app_state.clone()).configure(app_config))
        .bind(("127.0.0.1", 8080))?
        .run()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test};

    #[actix_web::test]
    async fn extract_creates_maintenance_work_item() {
        let app_state = web::Data::new(AppState::new());
        let app =
            test::init_service(App::new().app_data(app_state.clone()).configure(app_config)).await;

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
        let app_state = web::Data::new(AppState::new());
        let app =
            test::init_service(App::new().app_data(app_state.clone()).configure(app_config)).await;

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
        let app_state = web::Data::new(AppState::new());
        let app =
            test::init_service(App::new().app_data(app_state.clone()).configure(app_config)).await;

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
}
