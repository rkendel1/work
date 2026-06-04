#[allow(dead_code)]
#[path = "src/contracts/capability_matrix.rs"]
mod capability_matrix;
#[allow(dead_code)]
#[path = "src/contracts/projection_boundaries.rs"]
mod projection_boundaries;
#[allow(dead_code)]
#[path = "src/knowledge/mod.rs"]
mod knowledge;

use std::{env, fs, path::PathBuf};

fn write_doc(docs_dir: &PathBuf, file_name: &str, contents: String) {
    let docs_file = docs_dir.join(file_name);
    if fs::read_to_string(&docs_file).ok().as_deref() != Some(contents.as_str()) {
        let _ = fs::write(docs_file, contents);
    }
}

fn main() {
    println!("cargo:rerun-if-changed=src/contracts/capability_matrix.rs");
    println!("cargo:rerun-if-changed=src/contracts/projection_boundaries.rs");
    println!("cargo:rerun-if-changed=src/knowledge/mod.rs");
    println!("cargo:rerun-if-changed=src/knowledge/graph.rs");
    println!("cargo:rerun-if-changed=src/knowledge/artifacts.rs");
    println!("cargo:rerun-if-changed=src/knowledge/dependencies.rs");
    println!("cargo:rerun-if-changed=src/knowledge/patterns.rs");
    println!("cargo:rerun-if-changed=src/knowledge/processes.rs");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let docs_dir = manifest_dir.join("../../docs/architecture");

    let _ = fs::create_dir_all(&docs_dir);
    write_doc(
        &docs_dir,
        "CAPABILITY_OWNERSHIP_MATRIX.md",
        capability_matrix::render_markdown(),
    );
    write_doc(
        &docs_dir,
        "KNOWLEDGE_RUNTIME.md",
        knowledge::render_markdown(),
    );
    write_doc(
        &docs_dir,
        "PROJECTION_BOUNDARIES.md",
        projection_boundaries::render_markdown(),
    );
}
