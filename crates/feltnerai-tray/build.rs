fn main() {
    println!("cargo:rerun-if-changed=../feltnerai-server/icons/icon.ico");
    embed_windows_resources();
}

// `winresource` is only a host-Windows build-dependency, so this must be a
// compile-time `cfg` gate rather than a runtime check — otherwise the symbol
// fails to resolve on macOS/Linux.
#[cfg(windows)]
fn embed_windows_resources() {
    winresource::WindowsResource::new()
        .set_icon("../feltnerai-server/icons/icon.ico")
        .set("ProductName", "FeltnerAI Tray")
        .set("FileDescription", "FeltnerAI server tray launcher")
        .compile()
        .expect("compile Windows executable resources");
}

#[cfg(not(windows))]
fn embed_windows_resources() {}
