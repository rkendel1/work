pub mod artifacts;
pub mod dependencies;
pub mod graph;
pub mod patterns;
pub mod processes;

#[derive(Debug, Default)]
pub struct KnowledgeRuntime;

impl KnowledgeRuntime {
    pub fn infer_processes(&self, observations: &[String]) -> Vec<processes::InferredProcess> {
        processes::infer_processes(observations)
    }

    pub fn infer_dependencies(
        &self,
        processes: &[processes::InferredProcess],
    ) -> Vec<dependencies::InferredDependency> {
        dependencies::infer_dependencies(processes)
    }

    pub fn infer_patterns(&self, observations: &[String]) -> Vec<patterns::InferredPattern> {
        patterns::infer_patterns(observations)
    }

    pub fn infer_artifacts(&self, observations: &[String]) -> Vec<artifacts::InferredArtifact> {
        artifacts::infer_artifacts(observations)
    }

    pub fn infer_operational_graph(
        &self,
        processes: Vec<processes::InferredProcess>,
        dependencies: Vec<dependencies::InferredDependency>,
        patterns: Vec<patterns::InferredPattern>,
        artifacts: Vec<artifacts::InferredArtifact>,
    ) -> graph::OperationalGraph {
        graph::OperationalGraph {
            processes,
            dependencies,
            patterns,
            artifacts,
        }
    }
}

pub fn render_markdown() -> String {
    String::from(
        "# Operational Knowledge Runtime\n\nGenerated from `services/rust-api/src/knowledge/mod.rs`.\n\n## Responsibilities\n\n- Infer processes\n- Infer dependencies\n- Infer behavioral patterns\n- Infer operational artifacts\n- Infer operational graph\n\n## Canonical Sources\n\n- Process Graphs\n- Behavioral Patterns\n- Operational Artifacts\n",
    )
}
