use super::processes::InferredProcess;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InferredDependency {
    pub from_process_id: String,
    pub to_process_id: String,
}

pub fn infer_dependencies(processes: &[InferredProcess]) -> Vec<InferredDependency> {
    processes
        .windows(2)
        .map(|window| InferredDependency {
            from_process_id: window[0].id.clone(),
            to_process_id: window[1].id.clone(),
        })
        .collect()
}
