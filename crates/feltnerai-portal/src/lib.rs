use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CREDENTIAL_SERVICE: &str = "FeltnerAI Portal";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    pub id: String,
    pub server_uuid: String,
    pub name: String,
    pub url: String,
    pub allow_insecure_http: bool,
    pub last_used_at: String,
}

fn profiles_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("profiles.json"))
}

fn read_profiles(app: &AppHandle) -> Result<Vec<ServerProfile>, String> {
    let path = profiles_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

fn write_profiles(app: &AppHandle, profiles: &[ServerProfile]) -> Result<(), String> {
    let path = profiles_path(app)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(profiles).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_profiles(app: AppHandle) -> Result<Vec<ServerProfile>, String> {
    read_profiles(&app)
}

#[tauri::command]
fn save_profile(app: AppHandle, profile: ServerProfile) -> Result<Vec<ServerProfile>, String> {
    let mut profiles = read_profiles(&app)?;
    if let Some(existing) = profiles
        .iter_mut()
        .find(|existing| existing.id == profile.id)
    {
        *existing = profile;
    } else {
        profiles.push(profile);
    }
    profiles.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    write_profiles(&app, &profiles)?;
    Ok(profiles)
}

#[tauri::command]
fn delete_profile(
    app: AppHandle,
    id: String,
    server_uuid: String,
) -> Result<Vec<ServerProfile>, String> {
    let mut profiles = read_profiles(&app)?;
    profiles.retain(|profile| profile.id != id);
    write_profiles(&app, &profiles)?;
    let _ = keyring::Entry::new(CREDENTIAL_SERVICE, &server_uuid)
        .and_then(|entry| entry.delete_credential());
    Ok(profiles)
}

#[tauri::command]
fn store_credential(server_uuid: String, token: String) -> Result<bool, String> {
    let entry =
        keyring::Entry::new(CREDENTIAL_SERVICE, &server_uuid).map_err(|error| error.to_string())?;
    entry
        .set_password(&token)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_credential(server_uuid: String) -> Result<Option<String>, String> {
    let entry =
        keyring::Entry::new(CREDENTIAL_SERVICE, &server_uuid).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_credential(server_uuid: String) -> Result<(), String> {
    let entry =
        keyring::Entry::new(CREDENTIAL_SERVICE, &server_uuid).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            store_credential,
            load_credential,
            delete_credential
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FeltnerAI Portal");
}
