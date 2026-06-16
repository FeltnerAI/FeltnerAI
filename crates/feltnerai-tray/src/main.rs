#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod tray;

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    tray::run()
}

#[cfg(not(windows))]
fn main() {
    eprintln!("feltnerai-tray is supported only on Windows; run feltnerai-server directly.");
    std::process::exit(1);
}
