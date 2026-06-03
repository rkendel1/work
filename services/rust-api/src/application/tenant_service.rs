use actix_web::web;

use super::super::{AppState, Tenant, domain::crosswalk::OperationalCrosswalk, lock_state};

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

    #[allow(dead_code)]
    pub fn bootstrap_crosswalk(&self, tenant: &Tenant) -> OperationalCrosswalk {
        OperationalCrosswalk::from_pack(&tenant.id, &tenant.vertical, &tenant.industry)
    }
}
