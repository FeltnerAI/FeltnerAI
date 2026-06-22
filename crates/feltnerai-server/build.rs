use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let frontend = manifest.join("../../frontend/dist");
    let fallback = manifest.join("static");
    let source = if frontend.join("index.html").exists() {
        frontend
    } else {
        fallback
    };
    println!("cargo:rustc-env=FELTNERAI_EMBED_DIR={}", source.display());
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed=../../frontend/dist");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    fs::create_dir_all(&source).expect("create frontend embed directory");
    embed_windows_resources();
}

// `winresource` is only pulled in as a host-Windows build-dependency (see
// Cargo.toml), so the call must be gated at compile time, not at runtime: a
// runtime `env::var("CARGO_CFG_TARGET_OS")` check still forces the symbol to
// resolve on macOS/Linux, which is what broke `cargo build` there.
#[cfg(windows)]
fn embed_windows_resources() {
    winresource::WindowsResource::new()
        .set_icon("icons/icon.ico")
        .set("ProductName", "FeltnerAI Server")
        .set("FileDescription", "FeltnerAI self-hosted AI server")
        .compile()
        .expect("compile Windows executable resources");
}

#[cfg(not(windows))]
fn embed_windows_resources() {}
