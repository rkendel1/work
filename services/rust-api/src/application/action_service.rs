use actix_web::web;

use super::super::{
    ActionDefinition, AppState, OrgUnit, actions_from_pack, load_pack, lock_state,
};

pub struct ActionService {
    pub state: web::Data<AppState>,
}

impl ActionService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub fn list_actions(
        &self,
        tenant_id: String,
        classification_type: Option<String>,
    ) -> Vec<ActionDefinition> {
        let state = lock_state(&self.state);
        let mut actions: Vec<ActionDefinition> = state
            .actions
            .iter()
            .filter(|action| action.tenant_id == tenant_id)
            .filter(|action| {
                if let Some(classification_type) = &classification_type {
                    action
                        .classification_types
                        .iter()
                        .any(|item| item == classification_type)
                } else {
                    true
                }
            })
            .cloned()
            .collect();

        if actions.is_empty()
            && let Some(tenant) = state.tenants.iter().find(|tenant| tenant.id == tenant_id)
        {
            let pack = load_pack(&tenant.vertical, &tenant.industry);
            let tenant_org_units: Vec<OrgUnit> = state
                .org_units
                .iter()
                .filter(|unit| unit.tenant_id == tenant_id)
                .cloned()
                .collect();
            actions = actions_from_pack(&tenant_id, &pack, &tenant_org_units)
                .into_iter()
                .filter(|action| {
                    if let Some(classification_type) = &classification_type {
                        action
                            .classification_types
                            .iter()
                            .any(|item| item == classification_type)
                    } else {
                        true
                    }
                })
                .collect();
        }

        actions
    }
}
