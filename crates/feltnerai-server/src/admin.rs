use std::collections::BTreeMap;

use axum::{
    Extension, Json,
    extract::{Multipart, Path, State},
    http::StatusCode,
};
use chrono::Utc;
use feltnerai_api_types::{
    Branding, ConfigureModelRequest, ConnectionTestResponse, CreateProviderRequest,
    CreateUserRequest, Model, Provider, ServerSettings, Theme, UpdateBrandingRequest,
    UpdateModelRequest, UpdateProviderRequest, UpdateServerSettingsRequest, UpdateUserRequest,
    User,
};
use feltnerai_core::{db::new_id, password::hash_password, validation};
use feltnerai_provider_openai::ProviderConfig;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{AuthSession, parse_uuid, user_from_row},
    error::{AppError, AppResult},
    platform,
    public_auth::{bad_validation, decrypt_headers, normalize_email, role_value},
    state::AppState,
};

pub async fn list_users(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<Vec<User>>> {
    session.require_admin()?;
    let rows = sqlx::query(
        "SELECT id, username, email, role, disabled, must_change_password, theme, created_at
         FROM users ORDER BY username COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.iter()
            .map(user_from_row)
            .collect::<AppResult<Vec<_>>>()?,
    ))
}

pub async fn create_user(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<User>)> {
    session.require_admin()?;
    let id = new_id();
    let username = validation::username(&request.username).map_err(bad_validation)?;
    let email = normalize_email(request.email)?;
    let password_hash = hash_password(&request.password).map_err(bad_validation)?;
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO users
         (id, username, email, password_hash, role, disabled, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&username)
    .bind(&email)
    .bind(password_hash)
    .bind(role_value(request.role.clone()))
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(User {
            id,
            username,
            email,
            role: request.role,
            disabled: false,
            must_change_password: true,
            theme: Theme::System,
            created_at: now,
        }),
    ))
}

pub async fn update_user(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(user_id): Path<Uuid>,
    Json(request): Json<UpdateUserRequest>,
) -> AppResult<Json<User>> {
    session.require_admin()?;
    let row = sqlx::query(
        "SELECT id, username, email, password_hash, role, disabled, must_change_password,
                theme, created_at
         FROM users WHERE id = ?",
    )
    .bind(user_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("User not found."))?;
    let current = user_from_row(&row)?;
    let username = request
        .username
        .as_deref()
        .map(validation::username)
        .transpose()
        .map_err(bad_validation)?
        .unwrap_or(current.username);
    let email = if let Some(email) = request.email {
        normalize_email(Some(email))?
    } else {
        current.email
    };
    let role = request.role.unwrap_or(current.role);
    let disabled = request.disabled.unwrap_or(current.disabled);
    let replacement = request
        .replacement_password
        .as_deref()
        .map(hash_password)
        .transpose()
        .map_err(bad_validation)?;
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "UPDATE users
         SET username = ?, email = ?, role = ?, disabled = ?,
             password_hash = COALESCE(?, password_hash),
             must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(username)
    .bind(email)
    .bind(role_value(role))
    .bind(disabled)
    .bind(&replacement)
    .bind(&replacement)
    .bind(Utc::now())
    .bind(user_id.to_string())
    .execute(&mut *transaction)
    .await?;
    if replacement.is_some() || disabled {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(user_id.to_string())
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    let row = sqlx::query(
        "SELECT id, username, email, role, disabled, must_change_password, theme, created_at
         FROM users WHERE id = ?",
    )
    .bind(user_id.to_string())
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(user_from_row(&row)?))
}

pub async fn delete_user(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(user_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    session.require_admin()?;
    if session.user.id == user_id {
        return Err(AppError::conflict("You cannot delete your own account."));
    }
    let result = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user_id.to_string())
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("User not found."));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_providers(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<Vec<Provider>>> {
    session.require_admin()?;
    let rows = sqlx::query(
        "SELECT id, name, base_url, encrypted_api_key, encrypted_headers, enabled, created_at
         FROM providers ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|row| provider_from_row(&state, row))
            .collect::<AppResult<Vec<_>>>()?,
    ))
}

pub async fn create_provider(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<CreateProviderRequest>,
) -> AppResult<(StatusCode, Json<Provider>)> {
    session.require_admin()?;
    if request.name.trim().is_empty() {
        return Err(AppError::bad_request("Provider name is required."));
    }
    let id = new_id();
    let base_url = validation::provider_base_url(&request.base_url).map_err(bad_validation)?;
    validation::additional_headers(&request.additional_headers).map_err(bad_validation)?;
    let api_key = encrypt_optional(&state, request.api_key.as_deref())?;
    let headers = encrypt_headers(&state, &request.additional_headers)?;
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO providers
         (id, name, base_url, encrypted_api_key, encrypted_headers, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(request.name.trim())
    .bind(&base_url)
    .bind(&api_key)
    .bind(headers)
    .bind(request.enabled)
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(Provider {
            id,
            name: request.name.trim().into(),
            base_url,
            has_api_key: api_key.is_some(),
            additional_header_names: request.additional_headers.keys().cloned().collect(),
            enabled: request.enabled,
            created_at: now,
        }),
    ))
}

pub async fn update_provider(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(provider_id): Path<Uuid>,
    Json(request): Json<UpdateProviderRequest>,
) -> AppResult<Json<Provider>> {
    session.require_admin()?;
    let row = provider_secret_row(&state, provider_id).await?;
    let current_name: String = row.try_get("name")?;
    let current_url: String = row.try_get("base_url")?;
    let current_key: Option<String> = row.try_get("encrypted_api_key")?;
    let current_headers: String = row.try_get("encrypted_headers")?;
    let current_enabled: bool = row.try_get("enabled")?;

    let name = request.name.unwrap_or(current_name);
    if name.trim().is_empty() {
        return Err(AppError::bad_request("Provider name is required."));
    }
    let base_url = request
        .base_url
        .as_deref()
        .map(validation::provider_base_url)
        .transpose()
        .map_err(bad_validation)?
        .unwrap_or(current_url);
    let api_key = if request.clear_api_key.unwrap_or(false) {
        None
    } else if let Some(value) = request.api_key.as_deref() {
        encrypt_optional(&state, Some(value))?
    } else {
        current_key
    };
    let encrypted_headers = if let Some(headers) = request.additional_headers {
        validation::additional_headers(&headers).map_err(bad_validation)?;
        encrypt_headers(&state, &headers)?
    } else {
        current_headers
    };
    sqlx::query(
        "UPDATE providers SET name = ?, base_url = ?, encrypted_api_key = ?,
         encrypted_headers = ?, enabled = ?, updated_at = ? WHERE id = ?",
    )
    .bind(name.trim())
    .bind(base_url)
    .bind(api_key)
    .bind(encrypted_headers)
    .bind(request.enabled.unwrap_or(current_enabled))
    .bind(Utc::now())
    .bind(provider_id.to_string())
    .execute(&state.pool)
    .await?;
    let row = provider_secret_row(&state, provider_id).await?;
    Ok(Json(provider_from_row(&state, &row)?))
}

pub async fn delete_provider(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(provider_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    session.require_admin()?;
    let result = sqlx::query("DELETE FROM providers WHERE id = ?")
        .bind(provider_id.to_string())
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Provider not found."));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn test_provider(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(provider_id): Path<Uuid>,
) -> AppResult<Json<ConnectionTestResponse>> {
    session.require_admin()?;
    let config = load_provider_config(&state, provider_id).await?;
    Ok(Json(match state.provider.models(&config).await {
        Ok(models) => ConnectionTestResponse {
            ok: true,
            message: format!("Connected successfully; found {} model(s).", models.len()),
            models,
        },
        Err(error) => ConnectionTestResponse {
            ok: false,
            message: error.to_string(),
            models: vec![],
        },
    }))
}

pub async fn list_models(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<Vec<Model>>> {
    session.require_admin()?;
    Ok(Json(fetch_models(&state, false).await?))
}

pub async fn configure_model(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(provider_id): Path<Uuid>,
    Json(request): Json<ConfigureModelRequest>,
) -> AppResult<Json<Model>> {
    session.require_admin()?;
    if request.upstream_id.trim().is_empty() || request.display_name.trim().is_empty() {
        return Err(AppError::bad_request(
            "Model ID and display name are required.",
        ));
    }
    let now = Utc::now();
    let mut transaction = state.pool.begin().await?;
    if request.is_default {
        sqlx::query("UPDATE models SET is_default = 0, updated_at = ? WHERE is_default = 1")
            .bind(now)
            .execute(&mut *transaction)
            .await?;
    }
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM models WHERE provider_id = ? AND upstream_id = ?")
            .bind(provider_id.to_string())
            .bind(request.upstream_id.trim())
            .fetch_optional(&mut *transaction)
            .await?;
    let id = existing
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|error| AppError::internal(error.to_string()))?
        .unwrap_or_else(new_id);
    sqlx::query(
        "INSERT INTO models
         (id, provider_id, upstream_id, display_name, enabled, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, upstream_id) DO UPDATE SET
           display_name = excluded.display_name, enabled = excluded.enabled,
           is_default = excluded.is_default, updated_at = excluded.updated_at",
    )
    .bind(id.to_string())
    .bind(provider_id.to_string())
    .bind(request.upstream_id.trim())
    .bind(request.display_name.trim())
    .bind(request.enabled)
    .bind(request.is_default)
    .bind(now)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    let models = fetch_models(&state, false).await?;
    let model = models
        .into_iter()
        .find(|model| model.id == id)
        .ok_or_else(|| AppError::internal("configured model disappeared"))?;
    Ok(Json(model))
}

pub async fn update_model(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(model_id): Path<Uuid>,
    Json(request): Json<UpdateModelRequest>,
) -> AppResult<Json<Model>> {
    session.require_admin()?;
    let row = sqlx::query(
        "SELECT provider_id, upstream_id, display_name, enabled, is_default
         FROM models WHERE id = ?",
    )
    .bind(model_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Model not found."))?;
    let provider_id: String = row.try_get("provider_id")?;
    let current_upstream: String = row.try_get("upstream_id")?;
    let current_display: String = row.try_get("display_name")?;
    let current_enabled: bool = row.try_get("enabled")?;
    let current_default: bool = row.try_get("is_default")?;

    let upstream_id = request
        .upstream_id
        .map(|value| value.trim().to_owned())
        .unwrap_or(current_upstream.clone());
    let display_name = request
        .display_name
        .map(|value| value.trim().to_owned())
        .unwrap_or(current_display);
    if upstream_id.is_empty() || display_name.is_empty() {
        return Err(AppError::bad_request(
            "Model ID and display name are required.",
        ));
    }
    let enabled = request.enabled.unwrap_or(current_enabled);
    let is_default = request.is_default.unwrap_or(current_default);

    if upstream_id != current_upstream {
        let clash: Option<String> = sqlx::query_scalar(
            "SELECT id FROM models WHERE provider_id = ? AND upstream_id = ? AND id != ?",
        )
        .bind(&provider_id)
        .bind(&upstream_id)
        .bind(model_id.to_string())
        .fetch_optional(&state.pool)
        .await?;
        if clash.is_some() {
            return Err(AppError::conflict(
                "Another model with that upstream ID already exists for this provider.",
            ));
        }
    }

    let now = Utc::now();
    let mut transaction = state.pool.begin().await?;
    if is_default {
        sqlx::query(
            "UPDATE models SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id != ?",
        )
        .bind(now)
        .bind(model_id.to_string())
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(
        "UPDATE models SET upstream_id = ?, display_name = ?, enabled = ?, is_default = ?,
         updated_at = ? WHERE id = ?",
    )
    .bind(&upstream_id)
    .bind(&display_name)
    .bind(enabled)
    .bind(is_default)
    .bind(now)
    .bind(model_id.to_string())
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    let models = fetch_models(&state, false).await?;
    let model = models
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| AppError::internal("updated model disappeared"))?;
    Ok(Json(model))
}

pub async fn delete_model(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(model_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    session.require_admin()?;
    let result = sqlx::query("DELETE FROM models WHERE id = ?")
        .bind(model_id.to_string())
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Model not found."));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_server_settings(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<ServerSettings>> {
    session.require_admin()?;
    get_server_settings_inner(&state).await.map(Json)
}

pub async fn update_server_settings(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<UpdateServerSettingsRequest>,
) -> AppResult<Json<ServerSettings>> {
    session.require_admin()?;
    let current = get_server_settings_inner(&state).await?;
    let public_url = request
        .public_url
        .as_deref()
        .map(validation::public_url)
        .transpose()
        .map_err(bad_validation)?
        .or(current.public_url);
    let trusted = request.trusted_proxies.unwrap_or(current.trusted_proxies);
    for address in &trusted {
        address.parse::<std::net::IpAddr>().map_err(|_| {
            AppError::bad_request(format!("Invalid trusted proxy address: {address}"))
        })?;
    }
    let lmstudio_cli_path = match request.lmstudio_cli_path {
        // An empty string clears the override and restores auto-detection.
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value.trim().to_owned()),
        None => current.lmstudio_cli_path,
    };
    sqlx::query(
        "UPDATE server_settings SET public_url = ?, trusted_proxies_json = ?,
         lmstudio_cli_path = ?, updated_at = ? WHERE singleton = 1",
    )
    .bind(&public_url)
    .bind(serde_json::to_string(&trusted).map_err(|error| AppError::internal(error.to_string()))?)
    .bind(&lmstudio_cli_path)
    .bind(Utc::now())
    .execute(&state.pool)
    .await?;
    if let Some(enabled) = request.start_at_login {
        platform::set_start_at_login(enabled)
            .map_err(|error| AppError::internal(error.to_string()))?;
    }
    get_server_settings_inner(&state).await.map(Json)
}

pub async fn update_branding(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<UpdateBrandingRequest>,
) -> AppResult<Json<Branding>> {
    session.require_admin()?;
    if request
        .custom_css
        .as_ref()
        .is_some_and(|css| css.len() > 65_536)
    {
        return Err(AppError::bad_request("Custom CSS cannot exceed 64 KiB."));
    }
    let row = sqlx::query(
        "SELECT server_name, accent_color, custom_css FROM server_settings
         WHERE singleton = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    let name = request.server_name.unwrap_or(row.try_get("server_name")?);
    if name.trim().is_empty() || name.len() > 100 {
        return Err(AppError::bad_request(
            "Server name must be between 1 and 100 characters.",
        ));
    }
    let accent = request
        .accent_color
        .as_deref()
        .map(validation::accent_color)
        .transpose()
        .map_err(bad_validation)?
        .unwrap_or(row.try_get("accent_color")?);
    let css = request.custom_css.or(row.try_get("custom_css")?);
    sqlx::query(
        "UPDATE server_settings SET server_name = ?, accent_color = ?,
         custom_css = ?, updated_at = ? WHERE singleton = 1",
    )
    .bind(name)
    .bind(accent)
    .bind(css)
    .bind(Utc::now())
    .execute(&state.pool)
    .await?;
    branding(&state).await.map(Json)
}

pub async fn upload_branding_asset(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(kind): Path<String>,
    mut multipart: Multipart,
) -> AppResult<StatusCode> {
    session.require_admin()?;
    if kind != "logo" && kind != "favicon" {
        return Err(AppError::not_found("Unknown branding asset."));
    }
    let field = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?
        .ok_or_else(|| AppError::bad_request("A file is required."))?;
    let mime = field
        .content_type()
        .map(str::to_owned)
        .ok_or_else(|| AppError::bad_request("The upload must include a content type."))?;
    let allowed = match kind.as_str() {
        "logo" => ["image/png", "image/jpeg", "image/webp"].as_slice(),
        _ => ["image/png", "image/x-icon", "image/vnd.microsoft.icon"].as_slice(),
    };
    if !allowed.contains(&mime.as_str()) {
        return Err(AppError::bad_request("Unsupported branding image type."));
    }
    let data = field
        .bytes()
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    if data.is_empty() || data.len() > 1_048_576 {
        return Err(AppError::bad_request(
            "Branding images must be between 1 byte and 1 MiB.",
        ));
    }
    let query = if kind == "logo" {
        "UPDATE server_settings SET logo_mime = ?, logo_data = ?, updated_at = ? WHERE singleton = 1"
    } else {
        "UPDATE server_settings SET favicon_mime = ?, favicon_data = ?, updated_at = ? WHERE singleton = 1"
    };
    sqlx::query(query)
        .bind(mime)
        .bind(data.as_ref())
        .bind(Utc::now())
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_branding_asset(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(kind): Path<String>,
) -> AppResult<StatusCode> {
    session.require_admin()?;
    let query = match kind.as_str() {
        "logo" => {
            "UPDATE server_settings SET logo_mime = NULL, logo_data = NULL, updated_at = ? WHERE singleton = 1"
        }
        "favicon" => {
            "UPDATE server_settings SET favicon_mime = NULL, favicon_data = NULL, updated_at = ? WHERE singleton = 1"
        }
        _ => return Err(AppError::not_found("Unknown branding asset.")),
    };
    sqlx::query(query)
        .bind(Utc::now())
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn fetch_models(state: &AppState, enabled_only: bool) -> AppResult<Vec<Model>> {
    let condition = if enabled_only {
        "WHERE m.enabled = 1 AND p.enabled = 1"
    } else {
        ""
    };
    let query = format!(
        "SELECT m.id, m.provider_id, p.name AS provider_name, m.upstream_id,
                m.display_name, m.enabled, m.is_default
         FROM models m JOIN providers p ON p.id = m.provider_id
         {condition}
         ORDER BY m.is_default DESC, m.display_name COLLATE NOCASE"
    );
    let rows = sqlx::query(&query).fetch_all(&state.pool).await?;
    rows.iter()
        .map(|row| {
            Ok(Model {
                id: parse_uuid(row.try_get("id")?)?,
                provider_id: parse_uuid(row.try_get("provider_id")?)?,
                provider_name: row.try_get("provider_name")?,
                upstream_id: row.try_get("upstream_id")?,
                display_name: row.try_get("display_name")?,
                enabled: row.try_get("enabled")?,
                is_default: row.try_get("is_default")?,
            })
        })
        .collect()
}

pub async fn load_provider_config(
    state: &AppState,
    provider_id: Uuid,
) -> AppResult<ProviderConfig> {
    let row = provider_secret_row(state, provider_id).await?;
    let encrypted_key: Option<String> = row.try_get("encrypted_api_key")?;
    let api_key = encrypted_key
        .as_deref()
        .map(|value| state.encryption.decrypt(value))
        .transpose()
        .map_err(|error| AppError::internal(error.to_string()))?
        .map(|value| value.to_string());
    Ok(ProviderConfig {
        base_url: row.try_get("base_url")?,
        api_key,
        additional_headers: decrypt_headers(
            state,
            row.try_get::<String, _>("encrypted_headers")?.as_str(),
        )?,
    })
}

async fn provider_secret_row(
    state: &AppState,
    provider_id: Uuid,
) -> AppResult<sqlx::sqlite::SqliteRow> {
    sqlx::query(
        "SELECT id, name, base_url, encrypted_api_key, encrypted_headers, enabled, created_at
         FROM providers WHERE id = ?",
    )
    .bind(provider_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Provider not found."))
}

fn provider_from_row(state: &AppState, row: &sqlx::sqlite::SqliteRow) -> AppResult<Provider> {
    let encrypted_headers: String = row.try_get("encrypted_headers")?;
    let headers = decrypt_headers(state, &encrypted_headers)?;
    Ok(Provider {
        id: parse_uuid(row.try_get("id")?)?,
        name: row.try_get("name")?,
        base_url: row.try_get("base_url")?,
        has_api_key: row
            .try_get::<Option<String>, _>("encrypted_api_key")?
            .is_some(),
        additional_header_names: headers.keys().cloned().collect(),
        enabled: row.try_get("enabled")?,
        created_at: row.try_get("created_at")?,
    })
}

fn encrypt_optional(state: &AppState, value: Option<&str>) -> AppResult<Option<String>> {
    value
        .filter(|value| !value.is_empty())
        .map(|value| state.encryption.encrypt(value))
        .transpose()
        .map_err(|error| AppError::internal(error.to_string()))
}

fn encrypt_headers(state: &AppState, headers: &BTreeMap<String, String>) -> AppResult<String> {
    state
        .encryption
        .encrypt(
            &serde_json::to_string(headers)
                .map_err(|error| AppError::internal(error.to_string()))?,
        )
        .map_err(|error| AppError::internal(error.to_string()))
}

async fn get_server_settings_inner(state: &AppState) -> AppResult<ServerSettings> {
    let row = sqlx::query(
        "SELECT public_url, trusted_proxies_json, lmstudio_cli_path
         FROM server_settings WHERE singleton = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    let trusted: String = row.try_get("trusted_proxies_json")?;
    Ok(ServerSettings {
        public_url: row.try_get("public_url")?,
        trusted_proxies: serde_json::from_str(&trusted)
            .map_err(|error| AppError::internal(error.to_string()))?,
        data_dir: state.config.data_dir.display().to_string(),
        startup_supported: platform::startup_supported(),
        start_at_login: platform::start_at_login()
            .map_err(|error| AppError::internal(error.to_string()))?,
        lmstudio_cli_path: row.try_get("lmstudio_cli_path")?,
    })
}

async fn branding(state: &AppState) -> AppResult<Branding> {
    let row = sqlx::query(
        "SELECT server_name, accent_color,
                logo_data IS NOT NULL AS has_logo,
                favicon_data IS NOT NULL AS has_favicon,
                custom_css IS NOT NULL AS has_css
         FROM server_settings WHERE singleton = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Branding {
        server_name: row.try_get("server_name")?,
        accent_color: row.try_get("accent_color")?,
        logo_url: row
            .try_get::<bool, _>("has_logo")?
            .then(|| "/api/v1/branding/logo".into()),
        favicon_url: row
            .try_get::<bool, _>("has_favicon")?
            .then(|| "/api/v1/branding/favicon".into()),
        custom_css_url: row
            .try_get::<bool, _>("has_css")?
            .then(|| "/api/v1/branding/custom.css".into()),
    })
}
