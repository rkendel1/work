#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrgStructureConfiguration {
    pub tenant_id: String,
    pub unit_id: String,
    pub parent_unit_id: Option<String>,
}
