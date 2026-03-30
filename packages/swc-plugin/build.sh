#!/bin/bash
set -e
rustup target add wasm32-wasip1 2>/dev/null || true
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/web_remarq_swc_plugin.wasm .
echo "Built: web_remarq_swc_plugin.wasm ($(du -h web_remarq_swc_plugin.wasm | cut -f1))"
