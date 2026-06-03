#[path = "src/contracts/capability_matrix.rs"]
mod capability_matrix;

use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=src/contracts/capability_matrix.rs");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let docs_dir = manifest_dir.join("../../docs/architecture");
    let docs_file = docs_dir.join("CAPABILITY_OWNERSHIP_MATRIX.md");
    let rendered = capability_matrix::render_markdown();

    let _ = fs::create_dir_all(&docs_dir);
    if fs::read_to_string(&docs_file).ok().as_deref() != Some(rendered.as_str()) {
        let _ = fs::write(docs_file, rendered);
    }
}
