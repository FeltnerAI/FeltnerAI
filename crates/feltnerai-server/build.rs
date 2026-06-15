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
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon("icons/icon.ico")
            .set("ProductName", "FeltnerAI Server")
            .set("FileDescription", "FeltnerAI self-hosted AI server")
            .compile()
            .expect("compile Windows executable resources");
    }
}
