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
    VaultKeyUpdated {
        tenant_id: String,
        key_id: String,
    },
}
