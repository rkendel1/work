use serde::{Deserialize, Serialize};

use super::{crosswalk::OperationalCrosswalk, process_graph::ProcessGraph};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsIsModel {
    pub tenant_id: String,
    pub crosswalk: OperationalCrosswalk,
    pub process_graph: ProcessGraph,
}
