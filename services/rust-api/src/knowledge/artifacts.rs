#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InferredArtifact {
    pub artifact_type: String,
    pub summary: String,
}

pub fn infer_artifacts(observations: &[String]) -> Vec<InferredArtifact> {
    observations
        .iter()
        .map(|observation| InferredArtifact {
            artifact_type: "operational_artifact".to_string(),
            summary: observation.clone(),
        })
        .collect()
}
