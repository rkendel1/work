use super::{artifacts::InferredArtifact, dependencies::InferredDependency, patterns::InferredPattern, processes::InferredProcess};

#[derive(Debug, Clone, PartialEq)]
pub struct OperationalGraph {
    pub processes: Vec<InferredProcess>,
    pub dependencies: Vec<InferredDependency>,
    pub patterns: Vec<InferredPattern>,
    pub artifacts: Vec<InferredArtifact>,
}
