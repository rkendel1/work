use super::capability_matrix::{RuntimeOwner, owner_for};

pub const RUST_ALLOWED_PROJECTION_ACTIONS: &[&str] = &["Emit Domain Events", "Publish Projection Events"];
pub const CONVEX_ALLOWED_PROJECTION_ACTIONS: &[&str] = &["Store Projections", "Serve Queries"];

pub const CONVEX_FORBIDDEN_OPERATIONAL_CAPABILITIES: &[&str] = &[
    "Work Creation",
    "Routing",
    "Action Execution",
    "Business Rules",
    "Meaning Inference",
    "Operational Artifact Generation",
    "Process Graph Generation",
];

pub fn ownership_violations() -> Vec<String> {
    let mut violations = Vec::new();

    for capability in RUST_ALLOWED_PROJECTION_ACTIONS {
        if owner_for(capability) != Some(RuntimeOwner::Rust) {
            violations.push(format!(
                "Rust must own projection boundary capability: {capability}"
            ));
        }
    }

    for capability in CONVEX_ALLOWED_PROJECTION_ACTIONS {
        if owner_for(capability) != Some(RuntimeOwner::Convex) {
            violations.push(format!(
                "Convex must own projection boundary capability: {capability}"
            ));
        }
    }

    for capability in CONVEX_FORBIDDEN_OPERATIONAL_CAPABILITIES {
        if owner_for(capability) == Some(RuntimeOwner::Convex) {
            violations.push(format!(
                "Convex may not own operational capability: {capability}"
            ));
        }
    }

    violations
}

pub fn render_markdown() -> String {
    let mut markdown = String::from("# Projection Boundaries\n\n");
    markdown.push_str("Generated from `services/rust-api/src/contracts/projection_boundaries.rs`.\n\n");
    markdown.push_str("## Allowed\n\n");
    markdown.push_str("### Rust\n\n");
    for capability in RUST_ALLOWED_PROJECTION_ACTIONS {
        markdown.push_str("- ");
        markdown.push_str(capability);
        markdown.push('\n');
    }
    markdown.push('\n');
    markdown.push_str("### Convex\n\n");
    for capability in CONVEX_ALLOWED_PROJECTION_ACTIONS {
        markdown.push_str("- ");
        markdown.push_str(capability);
        markdown.push('\n');
    }
    markdown.push('\n');
    markdown.push_str("## Forbidden for Convex\n\n");
    for capability in CONVEX_FORBIDDEN_OPERATIONAL_CAPABILITIES {
        markdown.push_str("- ");
        markdown.push_str(capability);
        markdown.push('\n');
    }
    markdown.push('\n');
    markdown
}
