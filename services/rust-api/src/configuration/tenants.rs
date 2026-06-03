#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantConfiguration {
    pub tenant_id: String,
    pub name: String,
    pub domain: String,
}
