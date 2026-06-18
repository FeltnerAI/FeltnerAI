//! Coding-agent project storage and the native folder picker.
//!
//! Projects are the working directories the agent operates in. They are kept
//! on this device in `projects.json` (next to `profiles.json`), mirroring the
//! atomic-write pattern used for server profiles.

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_used_at: String,
}

fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("projects.json"))
}

fn read_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let path = projects_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

fn write_projects(app: &AppHandle, projects: &[Project]) -> Result<(), String> {
    let path = projects_path(app)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(projects).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    read_projects(&app)
}

#[tauri::command]
pub fn save_project(app: AppHandle, project: Project) -> Result<Vec<Project>, String> {
    let mut projects = read_projects(&app)?;
    if let Some(existing) = projects
        .iter_mut()
        .find(|existing| existing.id == project.id)
    {
        *existing = project;
    } else {
        projects.push(project);
    }
    projects.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    write_projects(&app, &projects)?;
    Ok(projects)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<Vec<Project>, String> {
    let mut projects = read_projects(&app)?;
    projects.retain(|project| project.id != id);
    write_projects(&app, &projects)?;
    Ok(projects)
}

/// Open the OS folder picker and return the chosen absolute path, or `None` if
/// the user cancelled. Runs on a worker thread (the command is `async`), which
/// is why the blocking dialog API is safe to use here.
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned()))
}
