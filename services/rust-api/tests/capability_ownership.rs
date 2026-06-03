#[path = "../src/contracts/capability_matrix.rs"]
mod capability_matrix;

use capability_matrix::{RuntimeOwner, owner_for};
use std::collections::HashSet;
use std::path::PathBuf;

#[test]
fn capability_ownership_rejects_cross_runtime_drift() {
    assert_eq!(owner_for("Classification"), Some(RuntimeOwner::Rust));
    assert_ne!(owner_for("Classification"), Some(RuntimeOwner::Convex));

    assert_eq!(owner_for("Routing"), Some(RuntimeOwner::Rust));
    assert_ne!(owner_for("Routing"), Some(RuntimeOwner::NextJs));

    assert_eq!(owner_for("Action Execution"), Some(RuntimeOwner::Rust));
    assert_ne!(owner_for("Action Execution"), Some(RuntimeOwner::Convex));

    assert_eq!(owner_for("Vault"), Some(RuntimeOwner::Rust));
    assert_ne!(owner_for("Vault"), Some(RuntimeOwner::NextJs));
}

#[test]
fn capability_ownership_matrix_is_single_source_of_truth() {
    let mut seen = HashSet::new();
    for entry in capability_matrix::CANONFLO_CAPABILITY_MATRIX {
        assert!(
            seen.insert(entry.capability),
            "duplicate capability ownership entry: {}",
            entry.capability
        );
    }
}

#[test]
fn capability_ownership_markdown_is_generated_from_matrix() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let docs_path = manifest_dir.join("../../docs/architecture/CAPABILITY_OWNERSHIP_MATRIX.md");
    let actual = std::fs::read_to_string(docs_path).expect("generated ownership markdown");
    assert_eq!(actual, capability_matrix::render_markdown());
}
