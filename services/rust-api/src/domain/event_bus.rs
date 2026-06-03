use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

use super::events::DomainEvent;

#[derive(Clone)]
pub struct EventBus {
    sender: Sender<DomainEvent>,
    _receiver: Arc<Mutex<Receiver<DomainEvent>>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        Self {
            sender,
            _receiver: Arc::new(Mutex::new(receiver)),
        }
    }

    pub fn publish(&self, event: DomainEvent) {
        let _ = self.sender.send(event);
    }

    #[cfg(test)]
    pub fn drain(&self) -> Vec<DomainEvent> {
        use std::sync::mpsc::TryRecvError;

        let mut drained = Vec::new();
        let Ok(receiver) = self._receiver.lock() else {
            return drained;
        };
        loop {
            match receiver.try_recv() {
                Ok(event) => drained.push(event),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
            }
        }
        drained
    }
}
