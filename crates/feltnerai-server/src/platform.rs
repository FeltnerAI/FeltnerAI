use anyhow::Result;

// Only referenced by the Windows registry startup helpers below.
#[cfg(windows)]
const STARTUP_VALUE_NAME: &str = "FeltnerAI Server";

pub fn startup_supported() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
pub fn start_at_login() -> Result<bool> {
    use std::io::ErrorKind;
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let run = match current_user.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") {
        Ok(run) => run,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    Ok(run.get_value::<String, _>(STARTUP_VALUE_NAME).is_ok())
}

#[cfg(not(windows))]
pub fn start_at_login() -> Result<bool> {
    Ok(false)
}

#[cfg(windows)]
pub fn set_start_at_login(enabled: bool) -> Result<()> {
    use std::io::ErrorKind;
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) =
        current_user.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")?;
    if enabled {
        let command = format!("\"{}\" --startup", startup_executable()?.display());
        run.set_value(STARTUP_VALUE_NAME, &command)?;
    } else if let Err(error) = run.delete_value(STARTUP_VALUE_NAME)
        && error.kind() != ErrorKind::NotFound
    {
        return Err(error.into());
    }
    Ok(())
}

/// Prefer the tray launcher beside the server so signing in starts FeltnerAI
/// without a console window; fall back to the server binary itself.
#[cfg(windows)]
fn startup_executable() -> Result<std::path::PathBuf> {
    let executable = std::env::current_exe()?;
    let tray = executable.with_file_name("feltnerai-tray.exe");
    Ok(if tray.exists() { tray } else { executable })
}

#[cfg(not(windows))]
pub fn set_start_at_login(enabled: bool) -> Result<()> {
    if enabled {
        anyhow::bail!("start at login is available only on Windows");
    }
    Ok(())
}
