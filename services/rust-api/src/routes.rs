use actix_web::web;

use super::{
    create_action, create_business_rule, create_org_unit, create_tenant, delete_vault_key,
    execute_action, extract, get_execution, get_process_graph, health, ingest, ingest_contract,
    ingest_signal, item_timeline, list_actions, list_behavioral_patterns, list_business_rules,
    list_executions, list_items, list_operational_artifacts, list_org_units, list_tenants,
    list_vault_keys, list_work, postmark_inbound, record_work_outcome, select_work_action,
    simulate, status, upsert_vault_key, validate_system, work_routing_preview,
};

pub fn app_config(cfg: &mut web::ServiceConfig) {
    cfg.route("/health", web::get().to(health))
        .route("/status", web::get().to(status))
    .route("/__system/validate", web::get().to(validate_system))
    .route("/simulate", web::get().to(simulate))
        .route("/ingest", web::get().to(ingest_contract))
        .route("/ingest", web::post().to(ingest))
    .route("/signal", web::post().to(ingest_signal))
    .route("/signals", web::post().to(ingest_signal))
        .route("/extract", web::post().to(extract))
        .route("/tenants", web::get().to(list_tenants))
        .route("/tenants", web::post().to(create_tenant))
        .route("/org/units", web::get().to(list_org_units))
        .route("/org/units", web::post().to(create_org_unit))
        .route("/business-rules", web::get().to(list_business_rules))
        .route("/business-rules", web::post().to(create_business_rule))
        .route("/actions", web::get().to(list_actions))
        .route("/actions", web::post().to(create_action))
        .route("/actions/execute", web::post().to(execute_action))
        .route("/executions", web::get().to(list_executions))
        .route("/executions/{id}", web::get().to(get_execution))
        .route("/vault/keys", web::get().to(list_vault_keys))
        .route("/vault/keys", web::post().to(upsert_vault_key))
        .route("/vault/keys", web::delete().to(delete_vault_key))
        .route("/items", web::get().to(list_items))
        .route("/items/{id}/timeline", web::get().to(item_timeline))
        .route("/work", web::get().to(list_work))
        .route("/behavioral-patterns", web::get().to(list_behavioral_patterns))
        .route("/operational-artifacts", web::get().to(list_operational_artifacts))
        .route("/process-graph", web::get().to(get_process_graph))
        .route("/work/routing-preview", web::get().to(work_routing_preview))
        .route("/work/{id}/selection", web::post().to(select_work_action))
        .route("/work/{id}/outcome", web::post().to(record_work_outcome))
        .route("/webhooks/postmark", web::post().to(postmark_inbound));
}
