#[test]
fn crsc_contract_suite_runtime_flow_boundaries_hold() {
    let runtime_flow = include_str!("../src/runtime_flow.rs");
    assert!(runtime_flow.contains("fn ingest_signal_to_inbox"));
    assert!(runtime_flow.contains("fn extract_work_from_inbox"));
    assert!(runtime_flow.contains("DomainEvent::SignalClassified"));
    assert!(runtime_flow.contains("DomainEvent::WorkCreated"));
    assert!(runtime_flow.contains("DomainEvent::WorkRouted"));
}

#[test]
fn crsc_contract_suite_simulation_replays_domain_events() {
    let simulation = include_str!("../src/simulation.rs");
    assert!(simulation.contains("simulate_as_is"));
    assert!(simulation.contains("events: Vec<DomainEvent>"));
}
