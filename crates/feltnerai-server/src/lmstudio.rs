//! Admin control of a local LM Studio installation via its CLI (`lms`).
//!
//! Everything here shells out to the `lms` executable; nothing runs through a
//! shell, and model identifiers are validated before being passed as arguments
//! so admins cannot inject extra flags. Models are never loaded automatically —
//! only the explicit endpoints below act, and only for authenticated admins.

use std::{
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};

use axum::{Extension, Json, extract::State};
use feltnerai_api_types::{
    LmStudioLoadRequest, LmStudioModel, LmStudioServerAction, LmStudioServerRequest,
    LmStudioStatus, LmStudioUnloadRequest,
};
use serde::Deserialize;
use tokio::process::Command;

use crate::{
    auth::AuthSession,
    error::{AppError, AppResult},
    state::AppState,
};

const EXE: &str = if cfg!(windows) { "lms.exe" } else { "lms" };
const QUICK: Duration = Duration::from_secs(20);
const LOAD: Duration = Duration::from_secs(180);

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

pub async fn status(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<LmStudioStatus>> {
    session.require_admin()?;
    Ok(Json(build_status(&state).await))
}

pub async fn server(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<LmStudioServerRequest>,
) -> AppResult<Json<LmStudioStatus>> {
    session.require_admin()?;
    let program = require_cli(&state).await?;
    let action = match request.action {
        LmStudioServerAction::Start => "start",
        LmStudioServerAction::Stop => "stop",
    };
    run_action(&program, &["server", action], QUICK).await?;
    Ok(Json(build_status(&state).await))
}

pub async fn load(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<LmStudioLoadRequest>,
) -> AppResult<Json<LmStudioStatus>> {
    session.require_admin()?;
    let program = require_cli(&state).await?;
    let model = validate_model(&request.model)?;
    let downloaded = list_models(&program, false).await;
    if !downloaded.is_empty() && !downloaded.iter().any(|item| item.id == model) {
        return Err(AppError::bad_request(
            "That model is not in LM Studio's downloaded list.",
        ));
    }
    let mut args: Vec<String> = vec!["load".into(), model, "--yes".into()];
    if let Some(context) = request.context_length.filter(|value| *value > 0) {
        args.push("--context-length".into());
        args.push(context.to_string());
    }
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run_action(&program, &borrowed, LOAD).await?;
    Ok(Json(build_status(&state).await))
}

pub async fn unload(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<LmStudioUnloadRequest>,
) -> AppResult<Json<LmStudioStatus>> {
    session.require_admin()?;
    let program = require_cli(&state).await?;
    match request.model {
        None => {
            run_action(&program, &["unload", "--all"], QUICK).await?;
        }
        Some(model) => {
            let model = validate_model(&model)?;
            run_action(&program, &["unload", &model], QUICK).await?;
        }
    }
    Ok(Json(build_status(&state).await))
}

// ---------------------------------------------------------------------------
// Status aggregation
// ---------------------------------------------------------------------------

async fn build_status(state: &AppState) -> LmStudioStatus {
    let (program, resolved) = lms_program(state).await;
    let raw_version = read_version(&program).await;
    let cli_path = resolved.then(|| program.display().to_string());
    if raw_version.is_none() {
        return LmStudioStatus {
            cli_available: false,
            cli_path,
            version: None,
            server_running: false,
            server_url: None,
            downloaded: vec![],
            loaded: vec![],
            message: Some(
                "LM Studio CLI (`lms`) was not found. Install LM Studio and ensure `lms` is on \
                 PATH, or set the CLI path in Server settings."
                    .into(),
            ),
        };
    }
    let version = raw_version.as_deref().and_then(clean_version);
    let (server_running, server_url) = server_status(&program).await;
    let downloaded = list_models(&program, false).await;
    let loaded = list_models(&program, true).await;
    LmStudioStatus {
        cli_available: true,
        cli_path,
        version,
        server_running,
        server_url,
        downloaded,
        loaded,
        message: None,
    }
}

async fn server_status(program: &Path) -> (bool, Option<String>) {
    #[derive(Deserialize)]
    struct ServerStatusJson {
        #[serde(default)]
        running: bool,
        #[serde(default)]
        port: Option<u16>,
    }

    if let Some(output) = run_text(program, &["server", "status", "--json"], QUICK).await
        && let Ok(status) = serde_json::from_str::<ServerStatusJson>(output.trim())
    {
        let url = status
            .running
            .then(|| format!("http://localhost:{}", status.port.unwrap_or(1234)));
        return (status.running, url);
    }
    // Older `lms` builds only print a human sentence.
    if let Some(text) = run_text(program, &["server", "status"], QUICK).await {
        let lower = text.to_lowercase();
        if lower.contains("not running") || lower.contains("isn't running") {
            return (false, None);
        }
        if lower.contains("running") {
            let port = extract_port(&lower).unwrap_or(1234);
            return (true, Some(format!("http://localhost:{port}")));
        }
    }
    (false, None)
}

fn extract_port(text: &str) -> Option<u16> {
    let after = text.split("port").nth(1)?;
    let digits: String = after
        .trim_start_matches([' ', ':'])
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// Run `lms ls`/`lms ps` with `--json` and parse the model list defensively.
async fn list_models(program: &Path, loaded: bool) -> Vec<LmStudioModel> {
    let subcommand = if loaded { "ps" } else { "ls" };
    let Some(output) = run_text(program, &[subcommand, "--json"], QUICK).await else {
        return vec![];
    };
    let raw: Vec<RawModel> = serde_json::from_str(output.trim()).unwrap_or_default();
    raw.into_iter()
        .filter_map(|model| model.into_model(loaded))
        .collect()
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawModel {
    model_key: Option<String>,
    path: Option<String>,
    identifier: Option<String>,
    address: Option<String>,
    display_name: Option<String>,
    size_bytes: Option<u64>,
    size: Option<u64>,
}

impl RawModel {
    fn into_model(self, loaded: bool) -> Option<LmStudioModel> {
        // Loaded models are unloaded by their runtime `identifier`; downloaded
        // models are loaded by their model key/path.
        let id = if loaded {
            self.identifier
                .or(self.model_key)
                .or(self.path)
                .or(self.address)
        } else {
            self.model_key
                .or(self.path)
                .or(self.identifier)
                .or(self.address)
        }
        .filter(|value| !value.trim().is_empty())?;
        Some(LmStudioModel {
            id,
            display_name: self.display_name.filter(|value| !value.trim().is_empty()),
            size_bytes: self.size_bytes.or(self.size),
        })
    }
}

// ---------------------------------------------------------------------------
// CLI discovery & process plumbing
// ---------------------------------------------------------------------------

/// Resolve the `lms` program path, falling back to a bare command name so the
/// OS PATH is still consulted at spawn time. The bool indicates whether a
/// concrete file was located (and therefore worth reporting to the admin).
async fn lms_program(state: &AppState) -> (PathBuf, bool) {
    match resolve_cli(state).await {
        Some(path) => (path, true),
        None => (PathBuf::from(EXE), false),
    }
}

async fn require_cli(state: &AppState) -> AppResult<PathBuf> {
    let (program, _) = lms_program(state).await;
    if read_version(&program).await.is_none() {
        return Err(AppError::bad_request(
            "LM Studio CLI (`lms`) is not available. Install LM Studio or set the CLI path in \
             Server settings.",
        ));
    }
    Ok(program)
}

/// Probe the CLI for a version banner, preferring the concise `--version` flag
/// and falling back to the `version` subcommand. Returns the raw stdout (which
/// may include ANSI art) so callers can both detect availability and parse it.
async fn read_version(program: &Path) -> Option<String> {
    if let Some(text) = run_text(program, &["--version"], QUICK).await {
        return Some(text);
    }
    run_text(program, &["version"], QUICK).await
}

/// `lms version` prints a colorful ASCII banner; reduce it to a clean version
/// number (or short commit hash) suitable for display.
fn clean_version(raw: &str) -> Option<String> {
    let stripped = strip_ansi(raw);
    if let Some(version) = find_semver(&stripped) {
        return Some(version);
    }
    if let Some(rest) = stripped.split("commit:").nth(1) {
        let commit: String = rest
            .trim()
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .collect();
        if !commit.is_empty() {
            return Some(format!("build {commit}"));
        }
    }
    None
}

/// Drop ANSI/VT escape sequences (`ESC [ ... <letter>`).
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(character);
    }
    out
}

/// Find the first `X.Y` / `X.Y.Z` style version token in arbitrary text.
fn find_semver(text: &str) -> Option<String> {
    text.split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find(|token| {
            let parts: Vec<&str> = token.split('.').collect();
            (2..=4).contains(&parts.len())
                && parts
                    .iter()
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(str::to_owned)
}

async fn resolve_cli(state: &AppState) -> Option<PathBuf> {
    let configured: Option<String> =
        sqlx::query_scalar("SELECT lmstudio_cli_path FROM server_settings WHERE singleton = 1")
            .fetch_one(&state.pool)
            .await
            .ok()
            .flatten();

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = configured.filter(|value| !value.trim().is_empty()) {
        candidates.push(PathBuf::from(path.trim()));
    }
    if let Ok(path) = std::env::var("FELTNERAI_LMS_PATH")
        && !path.trim().is_empty()
    {
        candidates.push(PathBuf::from(path.trim()));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|dir| dir.join(EXE)));
    }
    candidates.extend(default_dirs().into_iter().map(|dir| dir.join(EXE)));

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn default_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    if let Some(home) = std::env::var_os("USERPROFILE") {
        dirs.push(PathBuf::from(home).join(".lmstudio").join("bin"));
    }
    #[cfg(not(windows))]
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".lmstudio").join("bin"));
        dirs.push(home.join(".cache").join("lm-studio").join("bin"));
    }
    dirs
}

fn validate_model(model: &str) -> AppResult<String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("A model identifier is required."));
    }
    if trimmed.starts_with('-') || trimmed.chars().any(|character| character.is_control()) {
        return Err(AppError::bad_request("Invalid model identifier."));
    }
    Ok(trimmed.to_owned())
}

fn command(program: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: keep `lms` from flashing a console when the server
        // runs windowless under the tray launcher. `creation_flags` is an
        // inherent method on tokio's Windows `Command`.
        command.creation_flags(0x0800_0000);
    }
    command
}

async fn run(program: &Path, args: &[&str], timeout: Duration) -> Result<Output, String> {
    match tokio::time::timeout(timeout, command(program, args).output()).await {
        Err(_) => Err("the `lms` command timed out".into()),
        Ok(Err(error)) => Err(error.to_string()),
        Ok(Ok(output)) => Ok(output),
    }
}

/// Run a read-only command, returning trimmed stdout on success, or `None` when
/// the binary is missing or the command failed (callers degrade gracefully).
async fn run_text(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let output = run(program, args, timeout).await.ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Run a mutating command, mapping a non-zero exit or spawn failure into a
/// clean error carrying the CLI's own stderr where available.
async fn run_action(program: &Path, args: &[&str], timeout: Duration) -> AppResult<()> {
    let output = run(program, args, timeout)
        .await
        .map_err(|error| AppError::bad_request(format!("`lms` could not run: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr.trim();
    Err(AppError::bad_request(if message.is_empty() {
        "The `lms` command failed.".to_owned()
    } else {
        format!("LM Studio: {message}")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_semver_version() {
        assert_eq!(clean_version("lms version 0.4.12"), Some("0.4.12".into()));
        assert_eq!(clean_version("v1.2"), Some("1.2".into()));
    }

    #[test]
    fn strips_ansi_banner_and_extracts_commit() {
        let banner = "\u{1b}[38;5;166m _ _\u{1b}[0m lms is LM Studio's CLI utility. \
                      CLI commit: efce996 Docs: https://lmstudio.ai";
        assert_eq!(clean_version(banner), Some("build efce996".into()));
        assert!(!strip_ansi(banner).contains('\u{1b}'));
        assert!(!strip_ansi(banner).contains("[38;5;166m"));
    }

    #[test]
    fn returns_none_without_version_or_commit() {
        assert_eq!(clean_version("just some banner text"), None);
    }
}
