use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, Method, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use feltnerai_api_types::{Role, Theme, User};
use feltnerai_core::crypto::{random_token, token_hash};
use sqlx::Row;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

pub const SESSION_COOKIE: &str = "feltnerai_session";
const SESSION_DAYS: i64 = 30;

#[derive(Clone, Debug)]
pub struct AuthSession {
    pub user: User,
    pub session_id: Uuid,
    pub kind: AuthKind,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthKind {
    Cookie,
    Bearer,
}

impl AuthSession {
    pub fn require_admin(&self) -> AppResult<()> {
        if matches!(self.user.role, Role::Admin) {
            Ok(())
        } else {
            Err(AppError::forbidden("Administrator access is required."))
        }
    }
}

pub struct IssuedSession {
    pub token: String,
    pub csrf_token: Option<String>,
    pub expires_at: DateTime<Utc>,
}

pub async fn issue_session(
    state: &AppState,
    user_id: Uuid,
    portal: bool,
) -> AppResult<IssuedSession> {
    let token = random_token();
    let csrf_token = (!portal).then(random_token);
    let session_id = Uuid::now_v7();
    let now = Utc::now();
    let expires_at = now + chrono::Duration::days(SESSION_DAYS);
    sqlx::query(
        "INSERT INTO sessions (id, token_hash, csrf_hash, user_id, expires_at, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(session_id.to_string())
    .bind(token_hash(&token))
    .bind(csrf_token.as_deref().map(token_hash))
    .bind(user_id.to_string())
    .bind(expires_at)
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok(IssuedSession {
        token,
        csrf_token,
        expires_at,
    })
}

pub fn cookie_header(token: &str) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}; Secure",
        Duration::from_secs(SESSION_DAYS as u64 * 24 * 60 * 60).as_secs()
    )
}

pub fn clear_cookie_header() -> String {
    format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure")
}

pub fn extract_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|part| {
            part.strip_prefix(&format!("{SESSION_COOKIE}="))
                .map(str::to_owned)
        })
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_owned)
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    match authenticate(&state, request.headers(), request.method()).await {
        Ok((session, token)) => {
            let refresh_cookie = session.kind == AuthKind::Cookie;
            request.extensions_mut().insert(session);
            let mut response = next.run(request).await;
            if refresh_cookie
                && !response.headers().contains_key(header::SET_COOKIE)
                && let Ok(value) = cookie_header(&token).parse()
            {
                response.headers_mut().append(header::SET_COOKIE, value);
            }
            response
        }
        Err(error) => error.into_response(),
    }
}

async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
    method: &Method,
) -> AppResult<(AuthSession, String)> {
    let (token, kind) = if let Some(token) = extract_bearer(headers) {
        (token, AuthKind::Bearer)
    } else if let Some(token) = extract_cookie(headers) {
        (token, AuthKind::Cookie)
    } else {
        return Err(AppError::unauthorized("Authentication is required."));
    };

    let row = sqlx::query(
        "SELECT s.id AS session_id, s.csrf_hash, s.expires_at,
                u.id, u.username, u.email, u.role, u.disabled, u.must_change_password,
                u.theme, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?",
    )
    .bind(token_hash(&token))
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::unauthorized("The session is invalid or expired."))?;

    let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
    let disabled: bool = row.try_get("disabled")?;
    if disabled || expires_at <= Utc::now() {
        let session_id: String = row.try_get("session_id")?;
        let _ = sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(session_id)
            .execute(&state.pool)
            .await;
        return Err(AppError::unauthorized("The session is invalid or expired."));
    }

    if kind == AuthKind::Cookie && !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
    {
        let expected: Option<String> = row.try_get("csrf_hash")?;
        let supplied = headers
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| AppError::forbidden("A CSRF token is required."))?;
        let valid = expected.is_some_and(|expected| {
            let supplied = token_hash(supplied);
            expected.as_bytes().ct_eq(supplied.as_bytes()).into()
        });
        if !valid {
            return Err(AppError::forbidden("The CSRF token is invalid."));
        }
    }

    let now = Utc::now();
    let new_expiry = now + chrono::Duration::days(SESSION_DAYS);
    let session_id = Uuid::parse_str(row.try_get::<String, _>("session_id")?.as_str())
        .map_err(|error| AppError::internal(error.to_string()))?;
    sqlx::query("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
        .bind(now)
        .bind(new_expiry)
        .bind(session_id.to_string())
        .execute(&state.pool)
        .await?;

    Ok((
        AuthSession {
            session_id,
            kind,
            expires_at: new_expiry,
            user: user_from_row(&row)?,
        },
        token,
    ))
}

/// Issue a fresh CSRF token for an existing cookie session, replacing the
/// stored hash. This lets a browser that kept its session cookie but lost the
/// in-page CSRF token (for example after being closed and reopened) recover a
/// valid token when it restores the session.
pub async fn rotate_csrf(state: &AppState, session_id: Uuid) -> AppResult<String> {
    let token = random_token();
    sqlx::query("UPDATE sessions SET csrf_hash = ? WHERE id = ?")
        .bind(token_hash(&token))
        .bind(session_id.to_string())
        .execute(&state.pool)
        .await?;
    Ok(token)
}

pub fn user_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<User> {
    let role = match row.try_get::<String, _>("role")?.as_str() {
        "admin" => Role::Admin,
        "user" => Role::User,
        value => {
            return Err(AppError::internal(format!(
                "invalid role in database: {value}"
            )));
        }
    };
    let theme = match row.try_get::<String, _>("theme")?.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        "system" => Theme::System,
        value => {
            return Err(AppError::internal(format!(
                "invalid theme in database: {value}"
            )));
        }
    };
    Ok(User {
        id: parse_uuid(row.try_get::<String, _>("id")?)?,
        username: row.try_get("username")?,
        email: row.try_get("email")?,
        role,
        disabled: row.try_get("disabled")?,
        must_change_password: row.try_get("must_change_password")?,
        theme,
        created_at: row.try_get("created_at")?,
    })
}

pub fn parse_uuid(value: String) -> AppResult<Uuid> {
    Uuid::parse_str(&value).map_err(|error| AppError::internal(error.to_string()))
}

pub fn setup_token_valid(expected: &Option<Arc<String>>, supplied: Option<&str>) -> bool {
    let (Some(expected), Some(supplied)) = (expected, supplied) else {
        return false;
    };
    expected.as_bytes().ct_eq(supplied.as_bytes()).into()
}
