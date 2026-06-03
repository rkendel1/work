#[path = "../src/contracts/capability_matrix.rs"]
mod capability_matrix;

use capability_matrix::RuntimeOwner;

#[test]
fn projection_boundaries_keep_rust_on_command_side_and_convex_on_query_side() {
    assert_eq!(
        capability_matrix::owner_for("Work Creation"),
        Some(RuntimeOwner::Rust)
    );
    assert_eq!(
        capability_matrix::owner_for("Action Execution"),
        Some(RuntimeOwner::Rust)
    );
    assert_eq!(
        capability_matrix::owner_for("Business Rules"),
        Some(RuntimeOwner::Rust)
    );
    assert_eq!(
        capability_matrix::owner_for("Projection Storage"),
        Some(RuntimeOwner::Convex)
    );
    assert_eq!(
        capability_matrix::owner_for("Read Models"),
        Some(RuntimeOwner::Convex)
    );
}
