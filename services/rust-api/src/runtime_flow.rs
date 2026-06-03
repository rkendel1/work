use serde_json::Value;
use uuid::Uuid;

use super::{
    InboxItem, IngressEvent, SignalEvent, SignalMetadata, SignalProvenance, State, WorkItem,
    classify_content, create_inbox_item, create_ingress_event, create_signal_event,
    create_work_item, domain::event_bus::EventBus, domain::events::DomainEvent,
    update_ingress_status,
};

pub(super) struct SignalIngestionInput {
    pub(super) tenant_id: String,
    pub(super) source_type: String,
    pub(super) inbox_source: Option<String>,
    pub(super) provenance: SignalProvenance,
    pub(super) raw_payload: Value,
    pub(super) normalized_content: String,
    pub(super) metadata: SignalMetadata,
}

pub(super) struct SignalIngestionResult {
    pub(super) signal_event: SignalEvent,
    pub(super) inbox_item: InboxItem,
    pub(super) received_event: Option<IngressEvent>,
    pub(super) published_event_ids: Vec<String>,
}

pub(super) struct WorkExtractionResult {
    pub(super) work_item: WorkItem,
    pub(super) is_new: bool,
    pub(super) status_updates: Vec<(Uuid, IngressEvent)>,
    pub(super) recommendation_events: Vec<(Uuid, IngressEvent)>,
    pub(super) published_event_ids: Vec<String>,
}

#[derive(Debug)]
pub(super) enum WorkExtractionError {
    InboxItemNotFound,
}

pub(super) fn ingest_signal_to_inbox(
    state: &mut State,
    event_bus: &EventBus,
    input: SignalIngestionInput,
) -> SignalIngestionResult {
    let SignalIngestionInput {
        tenant_id,
        source_type,
        inbox_source,
        provenance,
        raw_payload,
        normalized_content,
        metadata,
    } = input;

    let signal_event = create_signal_event(
        state,
        tenant_id.clone(),
        source_type.clone(),
        provenance,
        raw_payload,
        normalized_content.clone(),
        metadata,
    );
    let inbox_source = inbox_source.unwrap_or_else(|| source_type.clone());
    let inbox_item = create_inbox_item(
        state,
        tenant_id.clone(),
        inbox_source,
        normalized_content.clone(),
    );
    let received_event = state.ingress_events.last().cloned();

    let signal_received_event_id = event_bus.publish(DomainEvent::SignalReceived {
        tenant_id: tenant_id.clone(),
        signal_id: signal_event.id.to_string(),
        source: source_type,
        content: normalized_content,
        timestamp: inbox_item.received_at.clone(),
    });
    let ingress_created_event_id = event_bus.publish(DomainEvent::IngressCreated {
        tenant_id,
        ingress_id: inbox_item.id.to_string(),
        signal_id: signal_event.id.to_string(),
    });

    SignalIngestionResult {
        signal_event,
        inbox_item,
        received_event,
        published_event_ids: vec![signal_received_event_id, ingress_created_event_id],
    }
}

pub(super) fn extract_work_from_inbox(
    state: &mut State,
    event_bus: &EventBus,
    inbox_item_id: Uuid,
) -> Result<WorkExtractionResult, WorkExtractionError> {
    if let Some(existing) = state
        .work_items
        .iter()
        .find(|work_item| work_item.inbox_item_id == inbox_item_id)
        .cloned()
    {
        return Ok(WorkExtractionResult {
            work_item: existing,
            is_new: false,
            status_updates: Vec::new(),
            recommendation_events: Vec::new(),
            published_event_ids: Vec::new(),
        });
    }

    let Some(inbox_item) = state
        .inbox_items
        .iter()
        .find(|item| item.id == inbox_item_id)
        .cloned()
    else {
        return Err(WorkExtractionError::InboxItemNotFound);
    };

    let classification_result = classify_content(&inbox_item.content);
    let work_item = create_work_item(state, &inbox_item);
    let signal_classified_event_id = event_bus.publish(DomainEvent::SignalClassified {
        tenant_id: inbox_item.tenant_id.clone(),
        signal_id: inbox_item.id.to_string(),
        classification: classification_result.classification,
        confidence: f64::from(classification_result.confidence),
    });

    let mut status_updates = Vec::new();
    if let Some(classified_event) = update_ingress_status(
        state,
        inbox_item.id,
        "classified",
        format!("Classification: {}", work_item.title),
    ) {
        status_updates.push((inbox_item.id, classified_event));
    }
    let recommendations_event = create_ingress_event(
        state,
        inbox_item.id,
        inbox_item.tenant_id.clone(),
        "recommendations_generated".to_string(),
        format!(
            "Generated {} recommended actions",
            work_item.recommended_actions.len()
        ),
    );
    if let Some(work_generated_event) = update_ingress_status(
        state,
        inbox_item.id,
        "work_generated",
        format!("Created Work Item {}", work_item.id),
    ) {
        status_updates.push((inbox_item.id, work_generated_event));
    }

    let work_created_event_id = event_bus.publish(DomainEvent::WorkCreated {
        tenant_id: inbox_item.tenant_id.clone(),
        work_id: work_item.id.to_string(),
        signal_id: inbox_item.id.to_string(),
    });
    let work_routed_event_id = event_bus.publish(DomainEvent::WorkRouted {
        tenant_id: inbox_item.tenant_id,
        work_id: work_item.id.to_string(),
        route: work_item.assigned_org_unit_id.to_string(),
    });

    Ok(WorkExtractionResult {
        work_item,
        is_new: true,
        status_updates,
        recommendation_events: vec![(inbox_item.id, recommendations_event)],
        published_event_ids: vec![
            signal_classified_event_id,
            work_created_event_id,
            work_routed_event_id,
        ],
    })
}

pub(super) fn emit_action_executed_event(
    event_bus: &EventBus,
    tenant_id: &str,
    execution_id: Uuid,
    action_id: Uuid,
    result: &str,
) -> String {
    event_bus.publish(DomainEvent::ActionExecuted {
        tenant_id: tenant_id.to_string(),
        execution_id: execution_id.to_string(),
        action_id: action_id.to_string(),
        result: result.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn ingest_flow_emits_signal_received_event() {
        let mut state = State::default();
        let event_bus = EventBus::new();
        let input = SignalIngestionInput {
            tenant_id: "default".to_string(),
            source_type: "api".to_string(),
            inbox_source: None,
            provenance: SignalProvenance {
                origin: "real".to_string(),
                generated_by: "system".to_string(),
            },
            raw_payload: json!({ "content": "HVAC alarm" }),
            normalized_content: "HVAC alarm".to_string(),
            metadata: SignalMetadata {
                sender: None,
                timestamp: 1,
                channel: None,
            },
        };

        let result = ingest_signal_to_inbox(&mut state, &event_bus, input);
        let events = event_bus.drain();

        assert_eq!(result.inbox_item.content, "HVAC alarm");
        assert_eq!(result.published_event_ids.len(), 2);
        assert_eq!(event_bus.stored_event_count(), 2);
        assert_eq!(event_bus.pending_outbox_count(), 2);
        assert!(events.iter().any(
            |event| matches!(event, DomainEvent::SignalReceived { source, .. } if source == "api")
        ));
        assert!(
            events
                .iter()
                .any(|event| matches!(event, DomainEvent::IngressCreated { .. }))
        );
    }

    #[test]
    fn extract_flow_emits_classification_and_work_events() {
        let mut state = State::default();
        let event_bus = EventBus::new();
        let ingestion = ingest_signal_to_inbox(
            &mut state,
            &event_bus,
            SignalIngestionInput {
                tenant_id: "default".to_string(),
                source_type: "api".to_string(),
                inbox_source: None,
                provenance: SignalProvenance {
                    origin: "real".to_string(),
                    generated_by: "system".to_string(),
                },
                raw_payload: json!({ "content": "Urgent HVAC issue" }),
                normalized_content: "Urgent HVAC issue".to_string(),
                metadata: SignalMetadata {
                    sender: None,
                    timestamp: 1,
                    channel: None,
                },
            },
        );
        let _ = event_bus.drain();

        let extraction = extract_work_from_inbox(&mut state, &event_bus, ingestion.inbox_item.id)
            .expect("work extraction should succeed");
        let events = event_bus.drain();

        assert!(extraction.is_new);
        assert_eq!(extraction.published_event_ids.len(), 3);
        assert_eq!(event_bus.stored_event_count(), 5);
        assert!(
            events
                .iter()
                .any(|event| matches!(event, DomainEvent::SignalClassified { .. }))
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, DomainEvent::WorkCreated { .. }))
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, DomainEvent::WorkRouted { .. }))
        );
    }
}
