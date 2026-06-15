mod admin;
mod assets;
mod auth;
pub mod backup;
mod chats;
mod error;
mod platform;
mod public_auth;
mod state;

use std::sync::Arc;

use anyhow::Result;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, header},
    middleware,
    routing::{delete, get, patch, post, put},
};
use feltnerai_core::{
    config::Config,
    crypto::{Encryption, random_token},
    db,
};
use feltnerai_provider_openai::OpenAiProvider;
use sqlx::Row;
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

pub use state::{AppState, ServerCommand};

pub async fn build_state(config: Config) -> Result<AppState> {
    let pool = db::connect(&config.data_dir).await?;
    if let Some(public_url) = &config.public_url {
        let public_url = feltnerai_core::validation::public_url(public_url)?;
        sqlx::query(
            "UPDATE server_settings SET public_url = ?, updated_at = ? WHERE singleton = 1",
        )
        .bind(public_url)
        .bind(chrono::Utc::now())
        .execute(&pool)
        .await?;
    }
    let setup_complete: bool =
        sqlx::query("SELECT setup_complete FROM server_settings WHERE singleton = 1")
            .fetch_one(&pool)
            .await?
            .try_get("setup_complete")?;
    let setup_token = (!setup_complete).then(|| Arc::new(random_token()));
    Ok(AppState {
        pool,
        encryption: Encryption::load_or_create(&config.data_dir)?,
        provider: OpenAiProvider::new()?,
        setup_token,
        generations: Default::default(),
        limiter: Default::default(),
        config,
        control: None,
    })
}

pub fn router(state: AppState) -> Router {
    let public = Router::new()
        .route("/health", get(public_auth::health))
        .route("/server", get(public_auth::handshake))
        .route("/setup/status", get(public_auth::setup_status))
        .route(
            "/setup/test-provider",
            post(public_auth::setup_test_provider),
        )
        .route("/setup/complete", post(public_auth::complete_setup))
        .route("/auth/login", post(public_auth::login))
        .route("/branding/logo", get(public_auth::branding_logo))
        .route("/branding/favicon", get(public_auth::branding_favicon))
        .route("/branding/custom.css", get(public_auth::branding_css));

    let protected = Router::new()
        .route("/auth/logout", post(public_auth::logout))
        .route("/auth/session", get(public_auth::current_session))
        .route("/auth/password", put(public_auth::change_password))
        .route("/auth/preferences", put(public_auth::update_preferences))
        .route("/models", get(chats::available_models))
        .route("/chats", get(chats::list_chats).post(chats::create_chat))
        .route(
            "/chats/{chat_id}",
            get(chats::get_chat)
                .patch(chats::update_chat)
                .delete(chats::delete_chat),
        )
        .route("/chats/{chat_id}/messages", get(chats::list_messages))
        .route("/chats/{chat_id}/generate", post(chats::generate))
        .route("/chats/{chat_id}/regenerate", post(chats::regenerate))
        .route("/chats/{chat_id}/stop", post(chats::stop_generation))
        .route(
            "/admin/users",
            get(admin::list_users).post(admin::create_user),
        )
        .route(
            "/admin/users/{user_id}",
            patch(admin::update_user).delete(admin::delete_user),
        )
        .route(
            "/admin/providers",
            get(admin::list_providers).post(admin::create_provider),
        )
        .route(
            "/admin/providers/{provider_id}",
            patch(admin::update_provider).delete(admin::delete_provider),
        )
        .route(
            "/admin/providers/{provider_id}/test",
            post(admin::test_provider),
        )
        .route(
            "/admin/providers/{provider_id}/models",
            post(admin::configure_model),
        )
        .route("/admin/models", get(admin::list_models))
        .route("/admin/models/{model_id}", delete(admin::delete_model))
        .route(
            "/admin/server",
            get(admin::get_server_settings).put(admin::update_server_settings),
        )
        .route("/admin/data/export", get(backup::export_data))
        .route(
            "/admin/data/import",
            post(backup::import_data).layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        .route("/admin/branding", put(admin::update_branding))
        .route(
            "/admin/branding/{kind}",
            post(admin::upload_branding_asset).delete(admin::delete_branding_asset),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ));

    let portal_cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list([
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("http://tauri.localhost"),
            HeaderValue::from_static("https://tauri.localhost"),
        ]))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::HeaderName::from_static("x-csrf-token"),
            header::HeaderName::from_static("x-setup-token"),
        ]);

    Router::new()
        .nest("/api/v1", public.merge(protected).layer(portal_cors))
        .route("/", get(assets::index))
        .route("/{*path}", get(assets::frontend))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
