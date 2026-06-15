use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use dashmap::DashMap;
use feltnerai_core::{config::Config, crypto::Encryption};
use feltnerai_provider_openai::OpenAiProvider;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerCommand {
    Exit,
    Restart,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub encryption: Encryption,
    pub provider: OpenAiProvider,
    pub setup_token: Option<Arc<String>>,
    pub generations: Arc<DashMap<Uuid, CancellationToken>>,
    pub limiter: Arc<RateLimiter>,
    pub config: Config,
    pub control: Option<mpsc::UnboundedSender<ServerCommand>>,
}

impl AppState {
    pub fn with_control(mut self, control: mpsc::UnboundedSender<ServerCommand>) -> Self {
        self.control = Some(control);
        self
    }

    pub fn request_restart(&self) {
        if let Some(control) = self.control.clone() {
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let _ = control.send(ServerCommand::Restart);
            });
        }
    }

    pub fn client_ip(&self, peer: SocketAddr, forwarded_for: Option<&str>) -> IpAddr {
        if self.config.trusted_proxies.contains(&peer.ip())
            && let Some(first) = forwarded_for.and_then(|value| value.split(',').next())
            && let Ok(address) = first.trim().parse()
        {
            return address;
        }
        peer.ip()
    }
}

#[derive(Default)]
pub struct RateLimiter {
    attempts: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn check(&self, key: String, limit: usize, window: Duration) -> bool {
        let now = Instant::now();
        let mut attempts = self.attempts.lock().expect("rate limiter lock poisoned");
        let entries = attempts.entry(key).or_default();
        while entries
            .front()
            .is_some_and(|instant| now.duration_since(*instant) > window)
        {
            entries.pop_front();
        }
        if entries.len() >= limit {
            return false;
        }
        entries.push_back(now);
        true
    }
}
