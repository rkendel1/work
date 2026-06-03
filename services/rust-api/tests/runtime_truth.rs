#[test]
fn runtime_truth_pipeline_stages_are_present_in_order() {
    let runtime_flow = include_str!("../src/runtime_flow.rs");
    let sequence = [
        "DomainEvent::SignalReceived",
        "DomainEvent::SignalClassified",
        "DomainEvent::WorkCreated",
        "DomainEvent::WorkRouted",
        "DomainEvent::ActionExecuted",
    ];

    let mut previous_index = 0usize;
    for stage in sequence {
        let idx = runtime_flow
            .find(stage)
            .unwrap_or_else(|| panic!("missing runtime stage marker: {stage}"));
        assert!(idx >= previous_index, "runtime stage order drifted at {stage}");
        previous_index = idx;
    }
}

#[test]
fn runtime_truth_simulation_does_not_mutate_command_records() {
    let simulate_handler = include_str!("../src/main.rs");
    let simulation_slice_start = simulate_handler
        .find("async fn simulate")
        .expect("simulate handler must exist");
    let simulation_slice_end = simulate_handler[simulation_slice_start..]
        .find("async fn router_debug")
        .map(|offset| simulation_slice_start + offset)
        .expect("router debug marker must follow simulate");
    let simulation_slice = &simulate_handler[simulation_slice_start..simulation_slice_end];

    assert!(!simulation_slice.contains("work_items.push"));
    assert!(!simulation_slice.contains("actions.push"));
    assert!(!simulation_slice.contains("execution_records.push"));
}
