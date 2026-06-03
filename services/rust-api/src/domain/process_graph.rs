use serde::{Deserialize, Serialize};

use super::super::application::crosswalk_engine::OperationalMeaning;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProcessGraph {
    pub nodes: Vec<ProcessNode>,
    pub edges: Vec<ProcessEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessNode {
    pub id: String,
    pub label: String,
    pub frequency: u64,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEdge {
    pub from: String,
    pub to: String,
    pub frequency: u64,
}

impl ProcessGraph {
    pub fn apply_meaning(&mut self, meaning: OperationalMeaning) {
        if let Some(category) = meaning.category {
            self.increment_node(category, meaning.confidence);
        }
    }

    fn increment_node(&mut self, label: String, confidence: f32) {
        if let Some(node) = self.nodes.iter_mut().find(|node| node.label == label) {
            node.frequency += 1;
            node.confidence = node.confidence.max(confidence).clamp(0.0, 1.0);
            return;
        }
        self.nodes.push(ProcessNode {
            id: format!("node_{}", self.nodes.len() + 1),
            label,
            frequency: 1,
            confidence: confidence.clamp(0.0, 1.0),
        });
    }
}
