use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DomainEvent {
    SignalReceived {
        tenant_id: String,
        signal_id: String,
        source: String,
        content: String,
        timestamp: DateTime<Utc>,
    },
    IngressCreated {
        tenant_id: String,
        ingress_id: String,
        signal_id: String,
    },
    SignalClassified {
        tenant_id: String,
        signal_id: String,
        classification: String,
        confidence: f64,
    },
    WorkCreated {
        tenant_id: String,
        work_id: String,
        signal_id: String,
    },
    WorkRouted {
        tenant_id: String,
        work_id: String,
        route: String,
    },
    ActionExecuted {
        tenant_id: String,
        execution_id: String,
        action_id: String,
        result: String,
    },
    MessageCreated {
        tenant_id: String,
        message_id: String,
    },
    NotificationCreated {
        tenant_id: String,
        notification_id: String,
    },
    RecipientResolved {
        tenant_id: String,
        recipient_id: String,
    },
    DeliveryRecorded {
        tenant_id: String,
        delivery_id: String,
    },
    VaultKeyUpdated {
        tenant_id: String,
        key_id: String,
    },
}

impl DomainEvent {
    pub fn tenant_id(&self) -> &str {
        match self {
            DomainEvent::SignalReceived { tenant_id, .. }
            | DomainEvent::IngressCreated { tenant_id, .. }
            | DomainEvent::SignalClassified { tenant_id, .. }
            | DomainEvent::WorkCreated { tenant_id, .. }
            | DomainEvent::WorkRouted { tenant_id, .. }
            | DomainEvent::ActionExecuted { tenant_id, .. }
            | DomainEvent::MessageCreated { tenant_id, .. }
            | DomainEvent::NotificationCreated { tenant_id, .. }
            | DomainEvent::RecipientResolved { tenant_id, .. }
            | DomainEvent::DeliveryRecorded { tenant_id, .. }
            | DomainEvent::VaultKeyUpdated { tenant_id, .. } => tenant_id,
        }
    }

    pub fn event_type(&self) -> &'static str {
        match self {
            DomainEvent::SignalReceived { .. } => "SignalReceived",
            DomainEvent::IngressCreated { .. } => "IngressCreated",
            DomainEvent::SignalClassified { .. } => "SignalClassified",
            DomainEvent::WorkCreated { .. } => "WorkCreated",
            DomainEvent::WorkRouted { .. } => "WorkRouted",
            DomainEvent::ActionExecuted { .. } => "ActionExecuted",
            DomainEvent::MessageCreated { .. } => "MessageCreated",
            DomainEvent::NotificationCreated { .. } => "NotificationCreated",
            DomainEvent::RecipientResolved { .. } => "RecipientResolved",
            DomainEvent::DeliveryRecorded { .. } => "DeliveryRecorded",
            DomainEvent::VaultKeyUpdated { .. } => "VaultKeyUpdated",
        }
    }
}
