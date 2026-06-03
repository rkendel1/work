use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalCrosswalk {
    pub tenant_id: String,
    pub vertical: String,
    pub industry: String,
    pub canonical_terms: Vec<CanonicalMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalMapping {
    pub source_term: String,
    pub canonical_type: String,
    pub confidence: f32,
    pub context_tags: Vec<String>,
}

impl OperationalCrosswalk {
    pub fn from_pack(tenant_id: &str, vertical: &str, industry: &str) -> Self {
        let canonical_terms = if vertical.eq_ignore_ascii_case("property_management")
            || (vertical.eq_ignore_ascii_case("property management")
                && industry.eq_ignore_ascii_case("commercial real estate"))
        {
            property_management_pack()
        } else if vertical.eq_ignore_ascii_case("healthcare")
            && industry.eq_ignore_ascii_case("clinic")
        {
            healthcare_pack()
        } else if vertical.eq_ignore_ascii_case("logistics") {
            logistics_pack()
        } else {
            default_pack()
        };

        Self {
            tenant_id: tenant_id.to_string(),
            vertical: vertical.to_string(),
            industry: industry.to_string(),
            canonical_terms,
        }
    }
}

pub fn property_management_pack() -> Vec<CanonicalMapping> {
    vec![
        CanonicalMapping {
            source_term: "hvac".to_string(),
            canonical_type: "maintenance_request".to_string(),
            confidence: 0.95,
            context_tags: vec!["operations".to_string(), "facilities".to_string()],
        },
        CanonicalMapping {
            source_term: "vendor".to_string(),
            canonical_type: "vendor_coordination".to_string(),
            confidence: 0.87,
            context_tags: vec!["procurement".to_string()],
        },
        CanonicalMapping {
            source_term: "lease".to_string(),
            canonical_type: "lease_question".to_string(),
            confidence: 0.88,
            context_tags: vec!["legal".to_string()],
        },
    ]
}

pub fn healthcare_pack() -> Vec<CanonicalMapping> {
    vec![
        CanonicalMapping {
            source_term: "appointment".to_string(),
            canonical_type: "appointment_request".to_string(),
            confidence: 0.9,
            context_tags: vec!["scheduling".to_string()],
        },
        CanonicalMapping {
            source_term: "patient".to_string(),
            canonical_type: "patient_issue".to_string(),
            confidence: 0.86,
            context_tags: vec!["clinical".to_string()],
        },
    ]
}

pub fn logistics_pack() -> Vec<CanonicalMapping> {
    vec![
        CanonicalMapping {
            source_term: "shipment".to_string(),
            canonical_type: "delivery_exception".to_string(),
            confidence: 0.9,
            context_tags: vec!["transport".to_string()],
        },
        CanonicalMapping {
            source_term: "warehouse".to_string(),
            canonical_type: "warehouse_operation".to_string(),
            confidence: 0.84,
            context_tags: vec!["inventory".to_string()],
        },
    ]
}

pub fn default_pack() -> Vec<CanonicalMapping> {
    vec![
        CanonicalMapping {
            source_term: "urgent".to_string(),
            canonical_type: "operational_request".to_string(),
            confidence: 0.7,
            context_tags: vec!["general".to_string()],
        },
        CanonicalMapping {
            source_term: "invoice".to_string(),
            canonical_type: "billing_inquiry".to_string(),
            confidence: 0.78,
            context_tags: vec!["finance".to_string()],
        },
    ]
}
