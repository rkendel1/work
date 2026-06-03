#[path = "../src/contracts/capability_matrix.rs"]
mod capability_matrix;
#[path = "../src/contracts/projection_boundaries.rs"]
mod projection_boundaries;

use capability_matrix::RuntimeOwner;

#[test]
fn projection_boundaries_allow_only_runtime_event_emission_and_projection_serving() {
    assert_eq!(
        capability_matrix::owner_for("Emit Domain Events"),
        Some(RuntimeOwner::Rust)
    );
    assert_eq!(
        capability_matrix::owner_for("Publish Projection Events"),
        Some(RuntimeOwner::Rust)
    );
    assert_eq!(
        capability_matrix::owner_for("Store Projections"),
        Some(RuntimeOwner::Convex)
    );
    assert_eq!(
        capability_matrix::owner_for("Serve Queries"),
        Some(RuntimeOwner::Convex)
    );
}

#[test]
fn projection_boundaries_prevent_convex_from_owning_operational_logic() {
    for capability in projection_boundaries::CONVEX_FORBIDDEN_OPERATIONAL_CAPABILITIES {
        assert_ne!(
            capability_matrix::owner_for(capability),
            Some(RuntimeOwner::Convex),
            "Convex may not own operational capability: {capability}"
        );
    }
}

#[test]
fn projection_boundary_contract_has_no_ownership_violations() {
    let violations = projection_boundaries::ownership_violations();
    assert!(violations.is_empty(), "{violations:?}");
}
