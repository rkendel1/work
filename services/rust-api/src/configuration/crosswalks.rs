#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrosswalkConfiguration {
    pub tenant_id: String,
    pub source_system: String,
    pub target_system: String,
}
