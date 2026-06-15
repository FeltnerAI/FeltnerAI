use std::{
    env, fs, io,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use directories::ProjectDirs;

#[derive(Debug, Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    pub public_url: Option<String>,
    pub log_filter: String,
    pub log_json: bool,
    pub trusted_proxies: Vec<IpAddr>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let data_dir = match env::var_os("FELTNERAI_DATA_DIR") {
            Some(path) => PathBuf::from(path),
            None => {
                let path = default_data_dir()?;
                migrate_legacy_data(&path)?;
                path
            }
        };
        let bind = env::var("FELTNERAI_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8080".into())
            .parse()
            .context("FELTNERAI_BIND must be a socket address")?;
        let public_url = env::var("FELTNERAI_PUBLIC_URL").ok();
        let log_filter =
            env::var("FELTNERAI_LOG").unwrap_or_else(|_| "feltnerai=info,tower_http=info".into());
        let log_json = env::var("FELTNERAI_LOG_JSON")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let trusted_proxies = env::var("FELTNERAI_TRUSTED_PROXIES")
            .unwrap_or_default()
            .split(',')
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().parse())
            .collect::<Result<Vec<_>, _>>()
            .context("FELTNERAI_TRUSTED_PROXIES must contain comma-separated IP addresses")?;

        Ok(Self {
            data_dir,
            bind,
            public_url,
            log_filter,
            log_json,
            trusted_proxies,
        })
    }
}

pub fn default_data_dir() -> Result<PathBuf> {
    ProjectDirs::from("ai", "FeltnerAI", "FeltnerAI Server")
        .map(|directories| directories.data_local_dir().to_owned())
        .context("the operating system did not provide a user data directory")
}

fn migrate_legacy_data(target: &Path) -> Result<()> {
    if target.join("feltnerai.db").exists() {
        return Ok(());
    }
    if target.exists() && fs::read_dir(target)?.next().is_some() {
        bail!(
            "the new data directory {} is not empty but has no FeltnerAI database",
            target.display()
        );
    }

    let mut candidates = Vec::new();
    if let Ok(executable) = env::current_exe()
        && let Some(parent) = executable.parent()
    {
        candidates.push(parent.join("data"));
    }
    if let Ok(current) = env::current_dir() {
        candidates.push(current.join("data"));
    }

    let Some(source) = candidates
        .into_iter()
        .find(|candidate| candidate != target && candidate.join("feltnerai.db").is_file())
    else {
        return Ok(());
    };

    copy_directory(&source, target).with_context(|| {
        format!(
            "failed to migrate legacy FeltnerAI data from {} to {}",
            source.display(),
            target.display()
        )
    })?;
    eprintln!(
        "Migrated FeltnerAI data from {} to {}. The legacy copy was preserved.",
        source.display(),
        target.display()
    );
    Ok(())
}

fn copy_directory(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&source_path, &target_path)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(source_path, target_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_legacy_data_without_removing_the_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("legacy");
        let target = root.path().join("new");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("feltnerai.db"), b"database").unwrap();
        fs::write(source.join("encryption.key"), [7_u8; 32]).unwrap();

        copy_directory(&source, &target).unwrap();

        assert_eq!(fs::read(target.join("feltnerai.db")).unwrap(), b"database");
        assert_eq!(fs::read(target.join("encryption.key")).unwrap(), [7_u8; 32]);
        assert!(source.join("feltnerai.db").exists());
    }
}
