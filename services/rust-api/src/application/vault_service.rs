use actix_web::web;

use super::super::{AppState, TenantSecretSummary, lock_state, tenant_secret_summary};

pub struct VaultService {
    pub state: web::Data<AppState>,
}

impl VaultService {
    pub fn new(state: web::Data<AppState>) -> Self {
        Self { state }
    }

    pub fn list_keys(&self, tenant_id: &str) -> Vec<TenantSecretSummary> {
        let state = lock_state(&self.state);
        state
            .tenant_secrets
            .iter()
            .filter(|secret| secret.tenant_id == tenant_id)
            .map(tenant_secret_summary)
            .collect()
    }
}
