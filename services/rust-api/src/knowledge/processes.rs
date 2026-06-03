#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InferredProcess {
    pub id: String,
    pub description: String,
}

pub fn infer_processes(observations: &[String]) -> Vec<InferredProcess> {
    observations
        .iter()
        .enumerate()
        .map(|(index, description)| InferredProcess {
            id: format!("process-{}", index + 1),
            description: description.clone(),
        })
        .collect()
}
