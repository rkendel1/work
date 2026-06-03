#[path = "../src/main.rs"]
mod api;

use actix_web::test;

#[actix_web::test]
async fn router_must_expose_core_surface() {
    let app = test::init_service(api::build_app(actix_web::web::Data::new(
        api::AppState::new(api::ConvexConfig::default()),
    )))
    .await;

    let health_req = test::TestRequest::get().uri("/health").to_request();
    let health_resp = test::call_service(&app, health_req).await;
    assert!(health_resp.status().is_success());

    let router_req = test::TestRequest::get().uri("/__router").to_request();
    let router_body = test::call_and_read_body(&app, router_req).await;
    assert_eq!(router_body.as_ref(), b"router=app_config::ACTIVE");
}
