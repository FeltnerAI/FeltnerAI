use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use axum::{
    Extension, Json,
    extract::{Multipart, State},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use chrono::Utc;
use feltnerai_api_types::{API_MAJOR, ImportDataResponse};
use feltnerai_core::crypto::Encryption;
use serde::{Deserialize, Serialize};
use sqlx::{Row, sqlite::SqlitePoolOptions};
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    auth::AuthSession,
    error::{AppError, AppResult},
    state::AppState,
};

const BACKUP_FORMAT: u32 = 1;
const MAX_BACKUP_BYTES: usize = 512 * 1024 * 1024;
const PENDING_DIRECTORY: &str = ".restore-pending";

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    application: String,
    format: u32,
    api_major: u16,
    version: String,
    created_at: String,
}

pub async fn export_data(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Response> {
    session.require_admin()?;
    let work = unique_directory(&state.config.data_dir, ".backup");
    fs::create_dir_all(&work).map_err(internal)?;
    let result = export_archive(&state, &work).await;
    let _ = fs::remove_dir_all(&work);
    let bytes = result?;
    let filename = format!(
        "feltnerai-backup-{}.zip",
        Utc::now().format("%Y%m%d-%H%M%S")
    );
    Ok((
        StatusCode::OK,
        [
            (CONTENT_TYPE, HeaderValue::from_static("application/zip")),
            (CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (
                CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                    .map_err(internal)?,
            ),
        ],
        bytes,
    )
        .into_response())
}

pub async fn import_data(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    mut multipart: Multipart,
) -> AppResult<Json<ImportDataResponse>> {
    session.require_admin()?;
    let field = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?
        .ok_or_else(|| AppError::bad_request("A FeltnerAI backup ZIP is required."))?;
    let bytes = field
        .bytes()
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    if bytes.is_empty() || bytes.len() > MAX_BACKUP_BYTES {
        return Err(AppError::bad_request(
            "The backup must be between 1 byte and 512 MiB.",
        ));
    }

    stage_archive(&state.config.data_dir, bytes.as_ref()).await?;
    state.request_restart();
    Ok(Json(ImportDataResponse {
        restart_required: true,
        message:
            "Backup validated. FeltnerAI is restarting with the imported data; sign in again when it is available."
                .into(),
    }))
}

async fn export_archive(state: &AppState, work: &Path) -> AppResult<Vec<u8>> {
    let snapshot = work.join("feltnerai.db");
    let escaped = snapshot.to_string_lossy().replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{escaped}'"))
        .execute(&state.pool)
        .await?;
    let database = fs::read(&snapshot).map_err(internal)?;
    let encryption_key =
        fs::read(state.config.data_dir.join("encryption.key")).map_err(internal)?;
    if encryption_key.len() != 32 {
        return Err(AppError::internal(
            "the server encryption key has an invalid length",
        ));
    }
    let manifest = BackupManifest {
        application: "FeltnerAI".into(),
        format: BACKUP_FORMAT,
        api_major: API_MAJOR,
        version: env!("CARGO_PKG_VERSION").into(),
        created_at: Utc::now().to_rfc3339(),
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut archive = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive
            .start_file("manifest.json", options)
            .map_err(internal)?;
        archive
            .write_all(&serde_json::to_vec_pretty(&manifest).map_err(internal)?)
            .map_err(internal)?;
        archive
            .start_file("feltnerai.db", options)
            .map_err(internal)?;
        archive.write_all(&database).map_err(internal)?;
        archive
            .start_file("encryption.key", options)
            .map_err(internal)?;
        archive.write_all(&encryption_key).map_err(internal)?;
        archive.finish().map_err(internal)?;
    }
    Ok(cursor.into_inner())
}

async fn stage_archive(data_dir: &Path, bytes: &[u8]) -> AppResult<()> {
    let staging = unique_directory(data_dir, ".restore-staging");
    fs::create_dir_all(&staging).map_err(internal)?;
    let result = extract_archive(bytes, &staging).and_then(|_| {
        let key = fs::read(staging.join("encryption.key"))?;
        if key.len() != 32 {
            bail!("encryption.key must contain exactly 32 bytes");
        }
        Ok(())
    });
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::bad_request(format!(
            "The backup could not be imported: {error}"
        )));
    }
    if let Err(error) = validate_backup_directory(&staging).await {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::bad_request(format!(
            "The backup failed validation: {error}"
        )));
    }

    let pending = data_dir.join(PENDING_DIRECTORY);
    if pending.exists() {
        fs::remove_dir_all(&pending).map_err(internal)?;
    }
    fs::rename(&staging, &pending).map_err(internal)?;
    Ok(())
}

fn extract_archive(bytes: &[u8], staging: &Path) -> Result<()> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).context("invalid ZIP archive")?;
    if archive.len() != 3 {
        bail!("the archive must contain exactly manifest.json, feltnerai.db, and encryption.key");
    }
    for name in ["manifest.json", "feltnerai.db", "encryption.key"] {
        let mut entry = archive
            .by_name(name)
            .with_context(|| format!("missing {name}"))?;
        let limit = match name {
            "manifest.json" => 64 * 1024,
            "encryption.key" => 32,
            _ => MAX_BACKUP_BYTES,
        };
        if entry.size() > limit as u64 {
            bail!("{name} is too large");
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take((limit + 1) as u64)
            .read_to_end(&mut data)?;
        if data.len() > limit {
            bail!("{name} is too large");
        }
        fs::write(staging.join(name), data)?;
    }
    let manifest: BackupManifest =
        serde_json::from_slice(&fs::read(staging.join("manifest.json"))?)?;
    if manifest.application != "FeltnerAI"
        || manifest.format != BACKUP_FORMAT
        || manifest.api_major != API_MAJOR
    {
        bail!("this is not a compatible FeltnerAI backup");
    }
    Ok(())
}

async fn validate_backup_directory(directory: &Path) -> Result<()> {
    let database = directory.join("feltnerai.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&database)
        .read_only(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .context("unable to open the backup database")?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await?;
    if integrity != "ok" {
        bail!("SQLite integrity check failed: {integrity}");
    }
    let active_admins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0")
            .fetch_one(&pool)
            .await
            .context("the backup is missing a valid users table")?;
    if active_admins == 0 {
        bail!("the backup has no active administrator");
    }
    let setup_complete: bool =
        sqlx::query_scalar("SELECT setup_complete FROM server_settings WHERE singleton = 1")
            .fetch_one(&pool)
            .await
            .context("the backup is missing server settings")?;
    if !setup_complete {
        bail!("the backup contains an incomplete server setup");
    }

    let encryption = Encryption::load_or_create(directory)?;
    let providers = sqlx::query("SELECT encrypted_api_key, encrypted_headers FROM providers")
        .fetch_all(&pool)
        .await
        .context("the backup is missing a valid providers table")?;
    for provider in providers {
        if let Some(key) = provider.try_get::<Option<String>, _>("encrypted_api_key")? {
            encryption
                .decrypt(&key)
                .context("the encryption key does not match provider credentials")?;
        }
        let headers: String = provider.try_get("encrypted_headers")?;
        encryption
            .decrypt(&headers)
            .context("the encryption key does not match provider headers")?;
    }
    pool.close().await;
    Ok(())
}

pub async fn apply_pending_restore(data_dir: &Path) -> Result<bool> {
    let pending = data_dir.join(PENDING_DIRECTORY);
    if !pending.exists() {
        return Ok(false);
    }
    validate_backup_directory(&pending)
        .await
        .context("pending restore failed validation")?;

    let rollback = data_dir.join(".restore-rollback");
    if rollback.exists() {
        fs::remove_dir_all(&rollback)?;
    }
    fs::create_dir_all(&rollback)?;
    for name in [
        "feltnerai.db",
        "feltnerai.db-wal",
        "feltnerai.db-shm",
        "encryption.key",
    ] {
        let source = data_dir.join(name);
        if source.is_file() {
            fs::copy(&source, rollback.join(name))?;
        }
    }

    let database_staging = data_dir.join("feltnerai.db.importing");
    let key_staging = data_dir.join("encryption.key.importing");
    fs::copy(pending.join("feltnerai.db"), &database_staging)?;
    fs::copy(pending.join("encryption.key"), &key_staging)?;
    for name in ["feltnerai.db-wal", "feltnerai.db-shm"] {
        let path = data_dir.join(name);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    replace_file(&database_staging, &data_dir.join("feltnerai.db"))?;
    replace_file(&key_staging, &data_dir.join("encryption.key"))?;
    fs::remove_dir_all(pending)?;
    Ok(true)
}

fn replace_file(source: &Path, target: &Path) -> Result<()> {
    if target.exists() {
        fs::remove_file(target)?;
    }
    fs::rename(source, target)?;
    Ok(())
}

fn unique_directory(parent: &Path, prefix: &str) -> PathBuf {
    parent.join(format!("{prefix}-{}", Uuid::now_v7()))
}

fn internal(error: impl std::fmt::Display) -> AppError {
    AppError::internal(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use feltnerai_core::{config::Config, db};

    #[test]
    fn rejects_archives_with_extra_entries() {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default();
            for name in [
                "manifest.json",
                "feltnerai.db",
                "encryption.key",
                "unexpected.txt",
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(b"x").unwrap();
            }
            writer.finish().unwrap();
        }
        let directory = tempfile::tempdir().unwrap();
        assert!(extract_archive(&cursor.into_inner(), directory.path()).is_err());
    }

    #[tokio::test]
    async fn applies_a_valid_staged_restore_after_the_pool_closes() {
        let data = tempfile::tempdir().unwrap();
        let config = Config {
            data_dir: data.path().to_owned(),
            bind: "127.0.0.1:0".parse().unwrap(),
            public_url: None,
            log_filter: "off".into(),
            log_json: false,
            trusted_proxies: vec![],
        };
        let state = crate::build_state(config).await.unwrap();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO users
             (id, username, password_hash, role, disabled, must_change_password, theme, created_at, updated_at)
             VALUES (?, 'admin', 'not-used', 'admin', 0, 0, 'system', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(now)
        .bind(now)
        .execute(&state.pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE server_settings SET server_name = 'Before export', setup_complete = 1 WHERE singleton = 1",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        let work = data.path().join("work");
        fs::create_dir_all(&work).unwrap();
        let archive = export_archive(&state, &work).await.unwrap();
        sqlx::query("UPDATE server_settings SET server_name = 'After export' WHERE singleton = 1")
            .execute(&state.pool)
            .await
            .unwrap();
        stage_archive(data.path(), &archive).await.unwrap();
        state.pool.close().await;

        assert!(apply_pending_restore(data.path()).await.unwrap());
        let restored = db::connect(data.path()).await.unwrap();
        let name: String =
            sqlx::query_scalar("SELECT server_name FROM server_settings WHERE singleton = 1")
                .fetch_one(&restored)
                .await
                .unwrap();
        assert_eq!(name, "Before export");
        restored.close().await;
    }
}
