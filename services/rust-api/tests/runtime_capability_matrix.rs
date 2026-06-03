#[path = "../src/contracts/capability_matrix.rs"]
mod capability_matrix;

#[test]
fn runtime_capability_matrix_covers_required_runtime_capabilities() {
    let required = [
        "Signal Ingestion",
        "Classification",
        "Meaning Inference",
        "Routing",
        "Work Creation",
        "Action Execution",
        "Communication Runtime",
        "Simulation Runtime",
        "Process Graph Generation",
        "Behavior Analytics",
        "Vault",
    ];

    for capability in required {
        assert!(
            capability_matrix::owner_for(capability).is_some(),
            "missing capability in matrix: {capability}"
        );
    }
}
