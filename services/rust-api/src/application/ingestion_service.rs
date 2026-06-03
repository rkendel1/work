use actix_web::web;
use chrono::Utc;

use super::super::{
    AppState, InboxItem, IngestRequest, SignalMetadata, default_signal_provenance,
    ensure_tenant_exists, forward_inbox_to_convex, forward_ingress_event_to_convex,
    forward_signal_event_to_convex, lock_state, normalize_signal_content, resolve_tenant_id,
    runtime_flow,
};

pub struct IngestionService {
    pub state: web::Data<AppState>,
}

impl IngestionService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub async fn ingest_raw(&self, request: IngestRequest) -> InboxItem {
        let (signal_event, item, received_event, published_event_ids) = {
            let mut state = lock_state(&self.state);
            let tenant_id = resolve_tenant_id(request.tenant_id.as_deref());
            ensure_tenant_exists(&mut state, &tenant_id);
            let raw_payload = serde_json::json!({
                "source": request.source.clone(),
                "content": request.content.clone(),
            });
            let normalized_content = normalize_signal_content(&raw_payload, Some(&request.content));
            let flow = runtime_flow::ingest_signal_to_inbox(
                &mut state,
                &self.state.event_bus,
                runtime_flow::SignalIngestionInput {
                    tenant_id,
                    source_type: request.source.clone(),
                    inbox_source: None,
                    provenance: default_signal_provenance(&request.source),
                    raw_payload,
                    normalized_content,
                    metadata: SignalMetadata {
                        sender: None,
                        timestamp: Utc::now().timestamp(),
                        channel: None,
                    },
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
        if let Err(error) = forward_signal_event_to_convex(
            &self.state.client,
            &self.state.convex_config,
            &signal_event,
        )
        .await
        {
            eprintln!("failed to forward signal event to convex: {error}");
            projection_error = Some(error.to_string());
        }
        if let Err(error) =
            forward_inbox_to_convex(&self.state.client, &self.state.convex_config, &item).await
        {
            eprintln!("failed to forward inbox item to convex: {error}");
            projection_error = Some(error.to_string());
        }
        if let Some(event) = received_event {
            if let Err(error) = forward_ingress_event_to_convex(
                &self.state.client,
                &self.state.convex_config,
                item.id,
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
                self.state
                    .event_bus
                    .mark_projection_failure(event_id, error.clone());
            }
        } else {
            for event_id in &published_event_ids {
                self.state.event_bus.mark_projection_success(event_id);
            }
        }

        item
    }
}
