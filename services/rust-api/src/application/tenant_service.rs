use actix_web::web;

use super::super::{AppState, Tenant, lock_state};

pub struct TenantService {
    pub state: web::Data<AppState>,
}

impl TenantService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub fn list_tenants(&self) -> Vec<Tenant> {
        let state = lock_state(&self.state);
        state.tenants.clone()
    }
}
