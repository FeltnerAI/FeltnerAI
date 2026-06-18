//! Filesystem and shell tools exposed to the coding agent.
//!
//! The agent loop runs in the webview, but the webview cannot touch the
//! filesystem or spawn processes, so every tool is a Tauri command here. Each
//! command takes the active project `root` and is sandboxed to it: a resolved
//! path that escapes the root is rejected before any I/O happens.

use std::{
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use ignore::WalkBuilder;
use regex::Regex;

const MAX_OUTPUT: usize = 24_000;
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_LIST: usize = 4_000;
const MAX_MATCHES: usize = 200;
const MAX_SEARCH_FILES: usize = 10_000;
const COMMAND_TIMEOUT_SECS: u64 = 120;
const IGNORED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".cache",
    ".turbo",
];

/// Lexically normalise a path (resolve `.`/`..` without touching the disk) so
/// the sandbox check cannot be fooled by `..` segments.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Resolve `rel` against the canonicalised project `root`, rejecting anything
/// that would escape the project directory. Existing paths (and the nearest
/// existing parent for new files) are canonicalised so symlinks cannot tunnel
/// the agent outside the selected project.
fn safe_path(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root)
        .map_err(|error| format!("invalid project directory: {error}"))?;
    let candidate = normalize(&root.join(rel));
    if !candidate.starts_with(&root) {
        return Err(format!("path {rel} is outside the project directory"));
    }
    if let Ok(real_candidate) = std::fs::canonicalize(&candidate) {
        if !real_candidate.starts_with(&root) {
            return Err(format!("path {rel} is outside the project directory"));
        }
        return Ok(real_candidate);
    }

    let mut ancestor = candidate.parent();
    while let Some(path) = ancestor {
        if path.exists() {
            let real_parent = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
            if !real_parent.starts_with(&root) {
                return Err(format!("path {rel} is outside the project directory"));
            }
            break;
        }
        ancestor = path.parent();
    }
    Ok(candidate)
}

fn truncate(mut text: String) -> String {
    if text.len() > MAX_OUTPUT {
        text.truncate(MAX_OUTPUT);
        text.push_str("\n… [output truncated]");
    }
    text
}

fn read_file_impl(
    root: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let resolved = safe_path(&root, &path)?;
    let text = std::fs::read_to_string(&resolved).map_err(|error| error.to_string())?;
    if offset.is_none() && limit.is_none() {
        return Ok(truncate(text));
    }
    let start = offset.unwrap_or(1).saturating_sub(1);
    let selected: Vec<&str> = match limit {
        Some(limit) => text.lines().skip(start).take(limit).collect(),
        None => text.lines().skip(start).collect(),
    };
    Ok(truncate(selected.join("\n")))
}

fn write_file_impl(root: String, path: String, content: String) -> Result<String, String> {
    let resolved = safe_path(&root, &path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&resolved, &content).map_err(|error| error.to_string())?;
    Ok(format!(
        "Wrote {} bytes to {}",
        content.len(),
        resolved.display()
    ))
}

fn edit_file_impl(root: String, path: String, old: String, new: String) -> Result<String, String> {
    let resolved = safe_path(&root, &path)?;
    let text = std::fs::read_to_string(&resolved).map_err(|error| error.to_string())?;
    let count = text.matches(&old).count();
    if count == 0 {
        return Err(format!(
            "the old string was not found in {}",
            resolved.display()
        ));
    }
    if count > 1 {
        return Err(format!(
            "the old string occurs {count} times in {}; make it unique",
            resolved.display()
        ));
    }
    std::fs::write(&resolved, text.replacen(&old, &new, 1)).map_err(|error| error.to_string())?;
    Ok(format!("Edited {}", resolved.display()))
}

fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name)
}

fn list_files_impl(root: String, path: Option<String>) -> Result<String, String> {
    let canonical_root = std::fs::canonicalize(&root).map_err(|error| error.to_string())?;
    let start = safe_path(&root, path.as_deref().unwrap_or("."))?;
    let mut found: Vec<String> = Vec::new();
    let walker = WalkBuilder::new(&start)
        .hidden(false)
        .filter_entry(|entry| !is_ignored(entry.file_name().to_string_lossy().as_ref()))
        .build();
    for entry in walker.flatten() {
        if found.len() >= MAX_LIST {
            break;
        }
        if entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            if let Ok(relative) = entry.path().strip_prefix(&canonical_root) {
                found.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    if found.is_empty() {
        Ok("(no files)".into())
    } else {
        Ok(truncate(found.join("\n")))
    }
}

fn search_impl(root: String, pattern: String, path: Option<String>) -> Result<String, String> {
    let regex = Regex::new(&pattern).map_err(|error| error.to_string())?;
    let canonical_root = std::fs::canonicalize(&root).map_err(|error| error.to_string())?;
    let start = safe_path(&root, path.as_deref().unwrap_or("."))?;
    let mut matches: Vec<String> = Vec::new();
    let mut scanned = 0usize;
    let walker = WalkBuilder::new(&start)
        .hidden(false)
        .filter_entry(|entry| !is_ignored(entry.file_name().to_string_lossy().as_ref()))
        .build();
    'outer: for entry in walker.flatten() {
        if matches.len() >= MAX_MATCHES || scanned >= MAX_SEARCH_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }
        scanned += 1;
        match entry.metadata() {
            Ok(metadata) if metadata.len() <= MAX_FILE_BYTES => {}
            _ => continue,
        }
        let text = match std::fs::read_to_string(entry.path()) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let display = match entry.path().strip_prefix(&canonical_root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        for (number, line) in text.lines().enumerate() {
            if regex.is_match(line) {
                matches.push(format!("{display}:{}: {}", number + 1, line.trim()));
                if matches.len() >= MAX_MATCHES {
                    break 'outer;
                }
            }
        }
    }
    if matches.is_empty() {
        Ok("(no matches)".into())
    } else {
        Ok(truncate(matches.join("\n")))
    }
}

fn run_command_impl(root: String, command: String) -> Result<String, String> {
    // Confirm the project directory exists before handing off to the shell.
    let root = std::fs::canonicalize(&root)
        .map_err(|error| format!("invalid project directory: {error}"))?;
    let mut shell = if cfg!(windows) {
        let mut command_builder = Command::new("cmd");
        command_builder.args(["/c", &command]);
        command_builder
    } else {
        let mut command_builder = Command::new("sh");
        command_builder.args(["-c", &command]);
        command_builder
    };
    let mut child = shell
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(COMMAND_TIMEOUT_SECS);
    let mut timed_out = false;
    loop {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            kill_child_tree(&mut child);
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut rendered = String::new();
    if !stdout.trim().is_empty() {
        rendered.push_str(stdout.trim_end());
        rendered.push('\n');
    }
    if !stderr.trim().is_empty() {
        rendered.push_str(stderr.trim_end());
        rendered.push('\n');
    }
    if timed_out {
        rendered.push_str(&format!(
            "[timed out after {COMMAND_TIMEOUT_SECS} seconds]\n"
        ));
    }
    rendered.push_str(&format!(
        "[exit status: {}]",
        output.status.code().unwrap_or(-1)
    ));
    Ok(truncate(rendered))
}

fn kill_child_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    }
    let _ = child.kill();
}

/// Run blocking tool work off the UI thread so long walks or commands never
/// freeze the webview.
async fn blocking<F>(work: F) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn agent_read_file(
    root: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    blocking(move || read_file_impl(root, path, offset, limit)).await
}

#[tauri::command]
pub async fn agent_write_file(
    root: String,
    path: String,
    content: String,
) -> Result<String, String> {
    blocking(move || write_file_impl(root, path, content)).await
}

#[tauri::command]
pub async fn agent_edit_file(
    root: String,
    path: String,
    old: String,
    new: String,
) -> Result<String, String> {
    blocking(move || edit_file_impl(root, path, old, new)).await
}

#[tauri::command]
pub async fn agent_list_files(root: String, path: Option<String>) -> Result<String, String> {
    blocking(move || list_files_impl(root, path)).await
}

#[tauri::command]
pub async fn agent_search(
    root: String,
    pattern: String,
    path: Option<String>,
) -> Result<String, String> {
    blocking(move || search_impl(root, pattern, path)).await
}

#[tauri::command]
pub async fn agent_run_command(root: String, command: String) -> Result<String, String> {
    blocking(move || run_command_impl(root, command)).await
}
