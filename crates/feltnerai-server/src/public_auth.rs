use std::{collections::BTreeMap, net::SocketAddr, time::Duration};

use axum::{
    Extension, Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use feltnerai_api_types::{
    API_MAJOR, Branding, Capabilities, ChangePasswordRequest, ConnectionTestResponse,
    HealthResponse, LoginRequest, ProviderDraft, Role, ServerHandshake, SessionResponse,
    SetupRequest, SetupStatus, Theme, UpdatePreferencesRequest, User,
};
use feltnerai_core::{
    db::new_id,
    password::{hash_password, verify_password},
    validation,
};
use feltnerai_provider_openai::ProviderConfig;
use sqlx::Row;

use crate::{
    auth::{
        AuthKind, AuthSession, clear_cookie_header, cookie_header, issue_session,
        setup_token_valid, user_from_row,
    },
    error::{AppError, AppResult},
    state::AppState,
};

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

pub async fn handshake(State(state): State<AppState>) -> AppResult<Json<ServerHandshake>> {
    let row = settings_row(&state).await?;
    Ok(Json(ServerHandshake {
        server_uuid: crate::auth::parse_uuid(row.try_get("server_uuid")?)?,
        api_major: API_MAJOR,
        version: env!("CARGO_PKG_VERSION").into(),
        setup_complete: row.try_get("setup_complete")?,
        public_url: row.try_get("public_url")?,
        capabilities: Capabilities::default(),
        branding: branding_from_row(&row)?,
    }))
}

pub async fn setup_status(State(state): State<AppState>) -> AppResult<Json<SetupStatus>> {
    let complete: bool =
        sqlx::query_scalar("SELECT setup_complete FROM server_settings WHERE singleton = 1")
            .fetch_one(&state.pool)
            .await?;
    Ok(Json(SetupStatus { complete }))
}

pub async fn setup_test_provider(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(provider): Json<ProviderDraft>,
) -> AppResult<Json<ConnectionTestResponse>> {
    setup_guard(&state, &headers, peer).await?;
    let config = provider_config_from_draft(provider)?;
    let result = state.provider.models(&config).await;
    Ok(Json(match result {
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

pub async fn complete_setup(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<SetupRequest>,
) -> AppResult<StatusCode> {
    setup_guard(&state, &headers, peer).await?;

    let username = validation::username(&request.username).map_err(bad_validation)?;
    let password_hash = hash_password(&request.password).map_err(bad_validation)?;
    let public_url = request
        .public_url
        .as_deref()
        .map(validation::public_url)
        .transpose()
        .map_err(bad_validation)?;
    let accent = request
        .accent_color
        .as_deref()
        .map(validation::accent_color)
        .transpose()
        .map_err(bad_validation)?
        .unwrap_or_else(|| "#6d5dfc".into());
    let server_name = request.server_name.trim();
    if server_name.is_empty() || server_name.len() > 100 {
        return Err(AppError::bad_request(
            "Server name must be between 1 and 100 characters.",
        ));
    }
    let email = normalize_email(request.email)?;
    let now = Utc::now();
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO users
         (id, username, email, password_hash, role, disabled, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', 0, 0, ?, ?)",
    )
    .bind(new_id().to_string())
    .bind(username)
    .bind(email)
    .bind(password_hash)
    .bind(now)
    .bind(now)
    .execute(&mut *transaction)
    .await?;

    if let Some(provider) = request.provider {
        let base_url = validation::provider_base_url(&provider.base_url).map_err(bad_validation)?;
        let headers = provider.additional_headers.unwrap_or_default();
        validation::additional_headers(&headers).map_err(bad_validation)?;
        let encrypted_api_key = provider
            .api_key
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| state.encryption.encrypt(value))
            .transpose()
            .map_err(|error| AppError::internal(error.to_string()))?;
        let encrypted_headers = state
            .encryption
            .encrypt(
                &serde_json::to_string(&headers).map_err(|e| AppError::internal(e.to_string()))?,
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        sqlx::query(
            "INSERT INTO providers
             (id, name, base_url, encrypted_api_key, encrypted_headers, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(new_id().to_string())
        .bind(provider.name.trim())
        .bind(base_url)
        .bind(encrypted_api_key)
        .bind(encrypted_headers)
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query(
        "UPDATE server_settings
         SET server_name = ?, public_url = ?, accent_color = ?, setup_complete = 1, updated_at = ?
         WHERE singleton = 1",
    )
    .bind(server_name)
    .bind(public_url)
    .bind(accent)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    tracing::info!("first-run setup completed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> AppResult<Response> {
    let forwarded = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok());
    let ip = state.client_ip(peer, forwarded);
    if !state
        .limiter
        .check(format!("login:{ip}"), 10, Duration::from_secs(15 * 60))
    {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many login attempts. Try again later.",
        ));
    }

    let row = sqlx::query(
        "SELECT id, username, email, password_hash, role, disabled, must_change_password,
                theme, created_at
         FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1",
    )
    .bind(request.login.trim())
    .bind(request.login.trim())
    .fetch_optional(&state.pool)
    .await?;
    let Some(row) = row else {
        let dummy = hash_password("invalid login password filler")
            .map_err(|error| AppError::internal(error.to_string()))?;
        let _ = verify_password(&dummy, &request.password);
        return Err(AppError::unauthorized(
            "Invalid username/email or password.",
        ));
    };
    let user = user_from_row(&row)?;
    let hash: String = row.try_get("password_hash")?;
    if user.disabled || !verify_password(&hash, &request.password) {
        return Err(AppError::unauthorized(
            "Invalid username/email or password.",
        ));
    }

    let issued = issue_session(&state, user.id, request.portal).await?;
    let response = SessionResponse {
        user,
        csrf_token: issued.csrf_token.clone(),
        bearer_token: request.portal.then_some(issued.token.clone()),
        expires_at: issued.expires_at,
    };
    let mut response = Json(response).into_response();
    if !request.portal {
        response.headers_mut().append(
            header::SET_COOKIE,
            cookie_header(&issued.token)
                .parse()
                .map_err(|error| AppError::internal(format!("cookie error: {error}")))?,
        );
    }
    Ok(response)
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Response> {
    sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session.session_id.to_string())
        .execute(&state.pool)
        .await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    if session.kind == AuthKind::Cookie {
        response.headers_mut().append(
            header::SET_COOKIE,
            clear_cookie_header()
                .parse()
                .map_err(|error| AppError::internal(format!("cookie error: {error}")))?,
        );
    }
    Ok(response)
}

pub async fn current_session(Extension(session): Extension<AuthSession>) -> Json<User> {
    Json(session.user)
}

pub async fn update_preferences(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<UpdatePreferencesRequest>,
) -> AppResult<Json<User>> {
    sqlx::query("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?")
        .bind(theme_value(request.theme))
        .bind(Utc::now())
        .bind(session.user.id.to_string())
        .execute(&state.pool)
        .await?;
    let row = sqlx::query(
        "SELECT id, username, email, role, disabled, must_change_password, theme, created_at
         FROM users WHERE id = ?",
    )
    .bind(session.user.id.to_string())
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(user_from_row(&row)?))
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    let current_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
        .bind(session.user.id.to_string())
        .fetch_one(&state.pool)
        .await?;
    if !verify_password(&current_hash, &request.current_password) {
        return Err(AppError::unauthorized("The current password is incorrect."));
    }
    let replacement = hash_password(&request.new_password).map_err(bad_validation)?;
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
    )
    .bind(replacement)
    .bind(Utc::now())
    .bind(session.user.id.to_string())
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = ? AND id != ?")
        .bind(session.user.id.to_string())
        .bind(session.session_id.to_string())
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn branding_logo(State(state): State<AppState>) -> AppResult<Response> {
    binary_branding(&state, "logo_mime", "logo_data").await
}

pub async fn branding_favicon(State(state): State<AppState>) -> AppResult<Response> {
    binary_branding(&state, "favicon_mime", "favicon_data").await
}

pub async fn branding_css(State(state): State<AppState>) -> AppResult<Response> {
    let css: Option<String> =
        sqlx::query_scalar("SELECT custom_css FROM server_settings WHERE singleton = 1")
            .fetch_one(&state.pool)
            .await?;
    let Some(css) = css else {
        return Err(AppError::not_found("No custom CSS has been configured."));
    };
    Ok((
        [
            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        css,
    )
        .into_response())
}

async fn binary_branding(
    state: &AppState,
    mime_column: &str,
    data_column: &str,
) -> AppResult<Response> {
    let query =
        format!("SELECT {mime_column}, {data_column} FROM server_settings WHERE singleton = 1");
    let row = sqlx::query(&query).fetch_one(&state.pool).await?;
    let mime: Option<String> = row.try_get(0)?;
    let data: Option<Vec<u8>> = row.try_get(1)?;
    match (mime, data) {
        (Some(mime), Some(data)) => Ok(([(header::CONTENT_TYPE, mime)], data).into_response()),
        _ => Err(AppError::not_found("Branding asset not found.")),
    }
}

async fn settings_row(state: &AppState) -> AppResult<sqlx::sqlite::SqliteRow> {
    Ok(sqlx::query(
        "SELECT server_uuid, server_name, public_url, accent_color,
                setup_complete, logo_data IS NOT NULL AS has_logo,
                favicon_data IS NOT NULL AS has_favicon, custom_css IS NOT NULL AS has_css
         FROM server_settings WHERE singleton = 1",
    )
    .fetch_one(&state.pool)
    .await?)
}

fn branding_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Branding> {
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

async fn setup_guard(state: &AppState, headers: &HeaderMap, peer: SocketAddr) -> AppResult<()> {
    let complete: bool =
        sqlx::query_scalar("SELECT setup_complete FROM server_settings WHERE singleton = 1")
            .fetch_one(&state.pool)
            .await?;
    if complete {
        return Err(AppError::conflict("Setup has already been completed."));
    }
    let supplied = headers
        .get("x-setup-token")
        .and_then(|value| value.to_str().ok());
    if !setup_token_valid(&state.setup_token, supplied) {
        return Err(AppError::unauthorized("The setup token is invalid."));
    }
    let forwarded = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok());
    let ip = state.client_ip(peer, forwarded);
    if !state
        .limiter
        .check(format!("setup:{ip}"), 20, Duration::from_secs(15 * 60))
    {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many setup attempts. Try again later.",
        ));
    }
    Ok(())
}

fn provider_config_from_draft(provider: ProviderDraft) -> AppResult<ProviderConfig> {
    let base_url = validation::provider_base_url(&provider.base_url).map_err(bad_validation)?;
    let additional_headers = provider.additional_headers.unwrap_or_default();
    validation::additional_headers(&additional_headers).map_err(bad_validation)?;
    Ok(ProviderConfig {
        base_url,
        api_key: provider.api_key,
        additional_headers,
    })
}

pub fn normalize_email(email: Option<String>) -> AppResult<Option<String>> {
    let email = email
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(value) = &email
        && (value.len() > 254 || !value.contains('@'))
    {
        return Err(AppError::bad_request("Email address is invalid."));
    }
    Ok(email)
}

pub fn theme_value(theme: Theme) -> &'static str {
    match theme {
        Theme::Light => "light",
        Theme::Dark => "dark",
        Theme::System => "system",
    }
}

pub fn role_value(role: Role) -> &'static str {
    match role {
        Role::Admin => "admin",
        Role::User => "user",
    }
}

pub fn bad_validation(error: anyhow::Error) -> AppError {
    AppError::bad_request(error.to_string())
}

pub fn decrypt_headers(state: &AppState, encrypted: &str) -> AppResult<BTreeMap<String, String>> {
    let value = state
        .encryption
        .decrypt(encrypted)
        .map_err(|error| AppError::internal(error.to_string()))?;
    serde_json::from_str(&value).map_err(|error| AppError::internal(error.to_string()))
}
