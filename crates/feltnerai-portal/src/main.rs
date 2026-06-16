// Prevents an extra console window on Windows in release builds. Keep the
// console in debug builds so logs remain visible during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    feltnerai_portal_lib::run();
}
