use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::super::domain::events::DomainEvent;

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    pub id: String,
    pub tenant_id: String,
    pub event_type: String,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OutboxStatus {
    Pending,
    Processed,
    Failed,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub id: String,
    pub event_id: String,
    pub status: OutboxStatus,
    pub attempts: u32,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub processed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct IdempotencyRecord {
    pub key: String,
    pub scope: String,
    pub response_payload: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Default)]
pub struct EventStore {
    events: Vec<StoredEvent>,
    outbox: Vec<OutboxEntry>,
    idempotency: HashMap<String, IdempotencyRecord>,
}

impl EventStore {
    pub fn append_domain_event(&mut self, event: &DomainEvent) -> String {
        let event_id = Uuid::new_v4().to_string();
        let created_at = Utc::now();
        let payload = serde_json::to_value(event).unwrap_or_else(|_| serde_json::json!({}));
        self.events.push(StoredEvent {
            id: event_id.clone(),
            tenant_id: event.tenant_id().to_string(),
            event_type: event.event_type().to_string(),
            payload,
            created_at,
        });
        self.outbox.push(OutboxEntry {
            id: Uuid::new_v4().to_string(),
            event_id: event_id.clone(),
            status: OutboxStatus::Pending,
            attempts: 0,
            last_error: None,
            created_at,
            processed_at: None,
        });
        event_id
    }

    #[cfg(test)]
    pub fn list_events(&self) -> Vec<StoredEvent> {
        self.events.clone()
    }

    pub fn mark_outbox_processed(&mut self, event_id: &str) {
        if let Some(entry) = self
            .outbox
            .iter_mut()
            .find(|entry| entry.event_id == event_id)
        {
            entry.attempts = entry.attempts.saturating_add(1);
            entry.status = OutboxStatus::Processed;
            entry.last_error = None;
            entry.processed_at = Some(Utc::now());
        }
    }

    pub fn mark_outbox_failed(&mut self, event_id: &str, error: String) {
        if let Some(entry) = self
            .outbox
            .iter_mut()
            .find(|entry| entry.event_id == event_id)
        {
            entry.attempts = entry.attempts.saturating_add(1);
            entry.status = OutboxStatus::Failed;
            entry.last_error = Some(error);
            entry.processed_at = None;
        }
    }

    #[cfg(test)]
    pub fn pending_outbox_count(&self) -> usize {
        self.outbox
            .iter()
            .filter(|entry| entry.status == OutboxStatus::Pending)
            .count()
    }

    pub fn get_idempotency(&self, scope: &str, key: &str) -> Option<Value> {
        let composite_key = format!("{scope}:{key}");
        self.idempotency
            .get(&composite_key)
            .map(|record| record.response_payload.clone())
    }

    pub fn put_idempotency(&mut self, scope: &str, key: &str, response_payload: Value) {
        let composite_key = format!("{scope}:{key}");
        self.idempotency.insert(
            composite_key,
            IdempotencyRecord {
                key: key.to_string(),
                scope: scope.to_string(),
                response_payload,
                created_at: Utc::now(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[test]
    fn appending_event_creates_outbox_entry() {
        let mut store = EventStore::default();
        let event_id = store.append_domain_event(&DomainEvent::SignalReceived {
            tenant_id: "default".to_string(),
            signal_id: "signal-1".to_string(),
            source: "api".to_string(),
            content: "test".to_string(),
            timestamp: Utc::now(),
        });

        assert!(!event_id.is_empty());
        assert_eq!(store.list_events().len(), 1);
        assert_eq!(store.pending_outbox_count(), 1);
    }

    #[test]
    fn idempotency_store_round_trips_payload() {
        let mut store = EventStore::default();
        store.put_idempotency("execute_action", "key-1", serde_json::json!({ "ok": true }));

        assert_eq!(
            store.get_idempotency("execute_action", "key-1"),
            Some(serde_json::json!({ "ok": true }))
        );
    }
}
