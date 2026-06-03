#!/bin/bash
set -euo pipefail

echo "Building Rust WASM ingress engine..."
rustup target add wasm32-unknown-unknown

WASM_BINDGEN_VERSION="0.2.122"
if ! command -v wasm-bindgen >/dev/null 2>&1 || ! wasm-bindgen --version | grep -q "${WASM_BINDGEN_VERSION}"; then
  echo "Installing wasm-bindgen-cli ${WASM_BINDGEN_VERSION}..."
  cargo install wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" --locked --force
fi

cargo build --release --target wasm32-unknown-unknown --lib
wasm-bindgen \
  target/wasm32-unknown-unknown/release/ingress_engine.wasm \
  --out-dir ../../apps/web/wasm \
  --target nodejs

echo "WASM build complete"
