use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utoipa::ToSchema;
use uuid::Uuid;

pub const API_MAJOR: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Role {
    Admin,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, ToSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Capabilities {
    pub chat_streaming: bool,
    pub portal_sessions: bool,
    pub custom_branding: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            chat_streaming: true,
            portal_sessions: true,
            custom_branding: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Branding {
    pub server_name: String,
    pub accent_color: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub custom_css_url: Option<String>,
}

impl Default for Branding {
    fn default() -> Self {
        Self {
            server_name: "FeltnerAI".into(),
            accent_color: "#6d5dfc".into(),
            logo_url: None,
            favicon_url: None,
            custom_css_url: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ServerHandshake {
    #[ts(type = "string")]
    pub server_uuid: Uuid,
    pub api_major: u16,
    pub version: String,
    pub setup_complete: bool,
    pub public_url: Option<String>,
    pub capabilities: Capabilities,
    pub branding: Branding,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct SetupStatus {
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ProviderDraft {
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub additional_headers: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct SetupRequest {
    pub server_name: String,
    pub public_url: Option<String>,
    pub accent_color: Option<String>,
    pub username: String,
    pub email: Option<String>,
    pub password: String,
    pub provider: Option<ProviderDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
    #[serde(default)]
    pub portal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct SessionResponse {
    pub user: User,
    pub csrf_token: Option<String>,
    pub bearer_token: Option<String>,
    #[ts(type = "string")]
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct User {
    #[ts(type = "string")]
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub role: Role,
    pub disabled: bool,
    pub must_change_password: bool,
    pub theme: Theme,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdatePreferencesRequest {
    pub theme: Theme,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct CreateUserRequest {
    pub username: String,
    pub email: Option<String>,
    pub password: String,
    pub role: Role,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    pub email: Option<String>,
    pub role: Option<Role>,
    pub disabled: Option<bool>,
    pub replacement_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Provider {
    #[ts(type = "string")]
    pub id: Uuid,
    pub name: String,
    pub base_url: String,
    pub has_api_key: bool,
    pub additional_header_names: Vec<String>,
    pub enabled: bool,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct CreateProviderRequest {
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub additional_headers: std::collections::BTreeMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateProviderRequest {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub clear_api_key: Option<bool>,
    pub additional_headers: Option<std::collections::BTreeMap<String, String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ConnectionTestResponse {
    pub ok: bool,
    pub message: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Model {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub provider_id: Uuid,
    pub provider_name: String,
    pub upstream_id: String,
    pub display_name: String,
    pub enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ConfigureModelRequest {
    pub upstream_id: String,
    pub display_name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateModelRequest {
    pub upstream_id: Option<String>,
    pub display_name: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Chat {
    #[ts(type = "string")]
    pub id: Uuid,
    pub title: String,
    #[ts(type = "string | null")]
    pub model_id: Option<Uuid>,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct CreateChatRequest {
    pub title: Option<String>,
    #[ts(type = "string | null")]
    pub model_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateChatRequest {
    pub title: Option<String>,
    #[ts(type = "string | null")]
    pub model_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MessageStatus {
    Complete,
    Streaming,
    Canceled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct Message {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub chat_id: Uuid,
    pub role: MessageRole,
    pub content: String,
    pub status: MessageStatus,
    #[ts(type = "string | null")]
    pub model_id: Option<Uuid>,
    pub provider_name: Option<String>,
    pub model_name: Option<String>,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct GenerateRequest {
    #[ts(type = "string")]
    pub request_id: Uuid,
    pub content: String,
    #[ts(type = "string | null")]
    pub model_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[serde(tag = "event", rename_all = "snake_case")]
#[ts(export)]
pub enum StreamEvent {
    Started {
        #[ts(type = "string")]
        message_id: Uuid,
    },
    Delta {
        content: String,
    },
    Completed {
        #[ts(type = "string")]
        message_id: Uuid,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ServerSettings {
    pub public_url: Option<String>,
    pub trusted_proxies: Vec<String>,
    pub data_dir: String,
    pub startup_supported: bool,
    pub start_at_login: bool,
    /// Optional override for the LM Studio CLI (`lms`) executable path. When
    /// unset the server auto-detects `lms` on PATH and in default install
    /// locations.
    pub lmstudio_cli_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateServerSettingsRequest {
    pub public_url: Option<String>,
    pub trusted_proxies: Option<Vec<String>>,
    pub start_at_login: Option<bool>,
    /// Set to `Some("")` to clear the override and fall back to auto-detection.
    pub lmstudio_cli_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct UpdateBrandingRequest {
    pub server_name: Option<String>,
    pub accent_color: Option<String>,
    pub custom_css: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ImportDataResponse {
    pub restart_required: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

/// A single model known to the local LM Studio installation.
#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LmStudioModel {
    /// Identifier passed to `lms load`/`lms unload` (the model key/path).
    pub id: String,
    /// Friendly display name when LM Studio reports one.
    pub display_name: Option<String>,
    /// Size on disk in bytes when known.
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
}

/// Aggregated state of the local LM Studio CLI and runtime.
#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LmStudioStatus {
    /// Whether the `lms` executable could be located and invoked.
    pub cli_available: bool,
    /// Resolved path to the `lms` executable, when found.
    pub cli_path: Option<String>,
    /// `lms version` output, when available.
    pub version: Option<String>,
    /// Whether the LM Studio local OpenAI-compatible server is running.
    pub server_running: bool,
    /// Base URL of the LM Studio local server when running.
    pub server_url: Option<String>,
    /// Models downloaded and available to load.
    pub downloaded: Vec<LmStudioModel>,
    /// Models currently loaded into memory.
    pub loaded: Vec<LmStudioModel>,
    /// Human-readable note (e.g. install hint) surfaced to admins.
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, ToSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum LmStudioServerAction {
    Start,
    Stop,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LmStudioServerRequest {
    pub action: LmStudioServerAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LmStudioLoadRequest {
    pub model: String,
    #[ts(type = "number | null")]
    pub context_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, ToSchema)]
#[ts(export)]
pub struct LmStudioUnloadRequest {
    /// Specific model to unload, or `None` to unload everything.
    pub model: Option<String>,
}
