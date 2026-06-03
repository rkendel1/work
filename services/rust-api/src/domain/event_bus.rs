use std::sync::{Arc, Mutex};
use tokio::sync::broadcast::{self, Receiver, Sender};

use super::events::DomainEvent;

#[derive(Clone)]
pub struct EventBus {
    sender: Arc<Sender<DomainEvent>>,
    _receiver: Arc<Mutex<Receiver<DomainEvent>>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, receiver) = broadcast::channel(1024);
        Self {
            sender: Arc::new(sender),
            _receiver: Arc::new(Mutex::new(receiver)),
        }
    }

    pub fn publish(&self, event: DomainEvent) {
        let _ = self.sender.send(event);
    }

    #[allow(dead_code)]
    pub fn subscribe(&self) -> Receiver<DomainEvent> {
        self.sender.subscribe()
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
}
