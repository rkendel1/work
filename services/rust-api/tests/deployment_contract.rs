#[path = "../src/main.rs"]
mod api;

use actix_web::{http::StatusCode, test, web};

#[actix_web::test]
async fn deployment_contract_core_routes_resolve_without_404() {
    let app = test::init_service(api::build_app(web::Data::new(api::AppState::new(
        api::ConvexConfig::default(),
    ))))
    .await;

    let routes = [
        "/health",
        "/status",
        "/ingest",
        "/simulate",
        "/actions",
        "/work",
        "/process-graph",
        "/business-rules",
        "/vault/keys",
        "/__system/validate",
    ];

    for route in routes {
        let req = test::TestRequest::get().uri(route).to_request();
        let resp = test::call_service(&app, req).await;
        assert_ne!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "route unexpectedly returned 404: {route}"
        );
    }
}

#[actix_web::test]
async fn deployment_contract_self_validation_endpoint_reports_green() {
    let app = test::init_service(api::build_app(web::Data::new(api::AppState::new(
        api::ConvexConfig::default(),
    ))))
    .await;

    let req = test::TestRequest::get()
        .uri("/__system/validate")
        .to_request();
    let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;

    assert_eq!(body.get("ok").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(body.get("runtime").and_then(|v| v.as_str()), Some("healthy"));
    assert_eq!(
        body.get("contracts").and_then(|v| v.as_str()),
        Some("passing")
    );
    assert_eq!(
        body.get("ownership").and_then(|v| v.as_str()),
        Some("passing")
    );
    assert_eq!(body.get("routes").and_then(|v| v.as_str()), Some("passing"));
    assert_eq!(
        body.get("capabilities").and_then(|v| v.as_str()),
        Some("passing")
    );
    assert_eq!(body.get("violations").and_then(|v| v.as_array()).map(Vec::len), Some(0));
}
