#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureFlagConfiguration {
    pub tenant_id: String,
    pub key: String,
    pub enabled: bool,
}
