use std::sync::{Arc, Mutex};
use tokio::sync::broadcast::{self, Receiver, Sender};

use super::super::infrastructure::event_store::EventStore;
use super::events::DomainEvent;

#[derive(Clone)]
pub struct EventBus {
    sender: Arc<Sender<DomainEvent>>,
    _receiver: Arc<Mutex<Receiver<DomainEvent>>>,
    event_store: Arc<Mutex<EventStore>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, receiver) = broadcast::channel(1024);
        Self {
            sender: Arc::new(sender),
            _receiver: Arc::new(Mutex::new(receiver)),
            event_store: Arc::new(Mutex::new(EventStore::default())),
        }
    }

    pub fn publish(&self, event: DomainEvent) -> String {
        let event_id = if let Ok(mut store) = self.event_store.lock() {
            store.append_domain_event(&event)
        } else {
            String::new()
        };
        let _ = self.sender.send(event);
        event_id
    }

    #[allow(dead_code)]
    pub fn subscribe(&self) -> Receiver<DomainEvent> {
        self.sender.subscribe()
    }

    pub fn mark_projection_success(&self, event_id: &str) {
        if let Ok(mut store) = self.event_store.lock() {
            store.mark_outbox_processed(event_id);
        }
    }

    pub fn mark_projection_failure(&self, event_id: &str, error: String) {
        if let Ok(mut store) = self.event_store.lock() {
            store.mark_outbox_failed(event_id, error);
        }
    }

    pub fn get_idempotency(&self, scope: &str, key: &str) -> Option<serde_json::Value> {
        let Ok(store) = self.event_store.lock() else {
            return None;
        };
        store.get_idempotency(scope, key)
    }

    pub fn put_idempotency(&self, scope: &str, key: &str, response_payload: serde_json::Value) {
        if let Ok(mut store) = self.event_store.lock() {
            store.put_idempotency(scope, key, response_payload);
        }
    }

    #[cfg(test)]
    pub fn drain(&self) -> Vec<DomainEvent> {
        use tokio::sync::broadcast::error::TryRecvError;

        let mut drained = Vec::new();
        let Ok(mut receiver) = self._receiver.lock() else {
            return drained;
        };
        loop {
            match receiver.try_recv() {
                Ok(event) => drained.push(event),
                Err(TryRecvError::Empty) | Err(TryRecvError::Closed) => break,
                Err(TryRecvError::Lagged(_)) => continue,
            }
        }
        drained
    }

    #[cfg(test)]
    pub fn stored_event_count(&self) -> usize {
        let Ok(store) = self.event_store.lock() else {
            return 0;
        };
        store.list_events().len()
    }

    #[cfg(test)]
    pub fn pending_outbox_count(&self) -> usize {
        let Ok(store) = self.event_store.lock() else {
            return 0;
        };
        store.pending_outbox_count()
    }
}
