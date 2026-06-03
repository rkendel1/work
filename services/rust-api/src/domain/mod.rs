// Phase 2 boundary: domain module is the home for event contracts and domain logic.
// Additional domain aggregates/services are introduced in Phase 3.
pub mod as_is_model;
pub mod crosswalk;
pub mod event_bus;
pub mod events;
pub mod process_graph;
