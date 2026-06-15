use std::{path::Path, str::FromStr, time::Duration};

use anyhow::Result;
use chrono::Utc;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use uuid::Uuid;

pub async fn connect(data_dir: &Path) -> Result<SqlitePool> {
    std::fs::create_dir_all(data_dir)?;
    let database_path = data_dir.join("feltnerai.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", database_path.display()))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10));
    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect_with(options)
        .await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;
    ensure_settings(&pool).await?;
    Ok(pool)
}

async fn ensure_settings(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO server_settings
         (singleton, server_uuid, server_name, accent_color, default_theme, setup_complete, updated_at)
         VALUES (1, ?, 'FeltnerAI', '#6d5dfc', 'system', 0, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(Utc::now())
    .execute(pool)
    .await?;
    Ok(())
}

pub fn new_id() -> Uuid {
    Uuid::now_v7()
}
