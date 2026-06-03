use super::{
    application::crosswalk_engine::CrosswalkEngine, domain::crosswalk::OperationalCrosswalk,
    domain::events::DomainEvent, domain::process_graph::ProcessGraph,
};

pub fn simulate_as_is(events: Vec<DomainEvent>, crosswalk: OperationalCrosswalk) -> ProcessGraph {
    let engine = CrosswalkEngine::from(crosswalk);
    let mut process_graph = ProcessGraph::default();
    for event in events {
        let meaning = engine.interpret(&event);
        process_graph.apply_meaning(meaning);
    }
    process_graph
}
