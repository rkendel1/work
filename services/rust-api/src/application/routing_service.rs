use actix_web::web;
use uuid::Uuid;

use super::super::{
    ActionType, AppState, OrgUnit, RecommendedAction, RuleEvaluationContext, WorkRoutingPreview,
    apply_business_rules, build_routing_path, lock_state,
};

pub struct RoutingService {
    pub state: web::Data<AppState>,
}

impl RoutingService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub fn preview(
        &self,
        tenant_id: String,
        classification_type: String,
        action_name: Option<String>,
        signal_content: &str,
    ) -> WorkRoutingPreview {
        let state = lock_state(&self.state);
        let selected_action = if let Some(action_name) = action_name.as_deref() {
            state.actions.iter().find(|action| {
                action.tenant_id == tenant_id
                    && action.active
                    && action.name.eq_ignore_ascii_case(action_name)
            })
        } else {
            state.actions.iter().find(|action| {
                action.tenant_id == tenant_id
                    && action.active
                    && action
                        .classification_types
                        .iter()
                        .any(|action_classification| action_classification == &classification_type)
            })
        };
        let mut assigned_org_unit = selected_action.and_then(|action| {
            state
                .org_units
                .iter()
                .find(|org_unit| org_unit.id == action.assigned_org_unit_id)
                .cloned()
        });
        let recommended_actions = action_name
            .as_deref()
            .map(|name| {
                vec![RecommendedAction {
                    title: name.to_string(),
                    description: "Routing preview action".to_string(),
                    action_type: ActionType::Review,
                }]
            })
            .unwrap_or_default();
        let initial_assigned_org_unit_id = assigned_org_unit
            .as_ref()
            .map(|org_unit| org_unit.id)
            .unwrap_or_else(Uuid::nil);
        let rule_context = RuleEvaluationContext {
            content: signal_content,
            classification_type: &classification_type,
            recommended_actions: &recommended_actions,
            assigned_org_unit_id: initial_assigned_org_unit_id,
        };
        let (
            priority_override,
            assigned_org_unit_override,
            escalation_target,
            suppress_action,
            require_approval,
            applied_rules,
        ) = apply_business_rules(&state, &tenant_id, &rule_context);
        if let Some(override_org_unit_id) = assigned_org_unit_override {
            assigned_org_unit = state
                .org_units
                .iter()
                .find(|org_unit| org_unit.id == override_org_unit_id)
                .cloned();
        }
        let routing_path: Vec<OrgUnit> = assigned_org_unit
            .as_ref()
            .map(|org_unit| {
                build_routing_path(&state, org_unit.id)
                    .into_iter()
                    .filter_map(|org_unit_id| {
                        state
                            .org_units
                            .iter()
                            .find(|org_unit| org_unit.id == org_unit_id)
                            .cloned()
                    })
                    .collect()
            })
            .unwrap_or_default();

        WorkRoutingPreview {
            tenant_id,
            classification_type,
            action_name,
            assigned_org_unit,
            routing_path,
            priority: priority_override.unwrap_or_else(|| "medium".to_string()),
            escalation_target,
            suppress_action,
            require_approval,
            applied_rules,
        }
    }
}
