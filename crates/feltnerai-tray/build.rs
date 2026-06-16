fn main() {
    println!("cargo:rerun-if-changed=../feltnerai-server/icons/icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon("../feltnerai-server/icons/icon.ico")
            .set("ProductName", "FeltnerAI Tray")
            .set("FileDescription", "FeltnerAI server tray launcher")
            .compile()
            .expect("compile Windows executable resources");
    }
}
