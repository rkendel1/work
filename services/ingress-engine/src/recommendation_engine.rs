use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Inspection,
    Notification,
    Review,
    Communication,
    Scheduling,
}

impl ActionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Inspection => "inspection",
            Self::Notification => "notification",
            Self::Review => "review",
            Self::Communication => "communication",
            Self::Scheduling => "scheduling",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedAction {
    pub title: String,
    pub description: String,
    pub action_type: ActionType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub classification: String,
    pub confidence: f32,
    pub priority: String,
    pub reason: String,
    pub entities: Vec<Entity>,
    pub recommendations: Vec<RecommendedAction>,
}

pub trait RecommendationGenerator {
    fn generate(&self, result: &ClassificationResult) -> Vec<RecommendedAction>;
}

pub struct RuleBasedRecommendationEngine;

impl RecommendationGenerator for RuleBasedRecommendationEngine {
    fn generate(&self, result: &ClassificationResult) -> Vec<RecommendedAction> {
        match result.classification.as_str() {
            "maintenance_request" => vec![
                RecommendedAction {
                    title: "Inspect HVAC Unit".to_string(),
                    description: "Inspect the impacted HVAC unit and assess required repair scope."
                        .to_string(),
                    action_type: ActionType::Inspection,
                },
                RecommendedAction {
                    title: "Notify Facilities Team".to_string(),
                    description: "Notify facilities with location/context and request follow-up."
                        .to_string(),
                    action_type: ActionType::Notification,
                },
            ],
            "billing_inquiry" => vec![
                RecommendedAction {
                    title: "Review Invoice".to_string(),
                    description: "Review invoice details and validate disputed line items.".to_string(),
                    action_type: ActionType::Review,
                },
                RecommendedAction {
                    title: "Respond To Customer".to_string(),
                    description: "Share investigation findings and next steps with the customer."
                        .to_string(),
                    action_type: ActionType::Communication,
                },
            ],
            "scheduling_request" => vec![
                RecommendedAction {
                    title: "Check Availability".to_string(),
                    description: "Check team and resource availability for requested dates."
                        .to_string(),
                    action_type: ActionType::Scheduling,
                },
                RecommendedAction {
                    title: "Send Appointment Options".to_string(),
                    description: "Provide available appointment options and confirmation path."
                        .to_string(),
                    action_type: ActionType::Communication,
                },
            ],
            _ => vec![RecommendedAction {
                title: "Triage Request".to_string(),
                description: "Review request details and route to the correct operational owner."
                    .to_string(),
                action_type: ActionType::Review,
            }],
        }
    }
}
