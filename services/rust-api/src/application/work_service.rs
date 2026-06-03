use actix_web::web;

use super::super::{AppState, WorkItem, lock_state};

pub struct WorkService {
    pub state: web::Data<AppState>,
}

impl WorkService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub fn list_work(&self, tenant_id: &str) -> Vec<WorkItem> {
        let state = lock_state(&self.state);
        state
            .work_items
            .iter()
            .filter(|work_item| work_item.tenant_id == tenant_id)
            .cloned()
            .collect()
    }
}
