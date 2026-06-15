pub mod config;
pub mod crypto;
pub mod db;
pub mod password;
pub mod validation;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("cryptographic operation failed")]
    Crypto,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}
