use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DomainEvent {
    SignalReceived {
        tenant_id: String,
        signal_id: String,
        content: String,
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
    ActionExecuted {
        tenant_id: String,
        execution_id: String,
        action_id: String,
    },
}
