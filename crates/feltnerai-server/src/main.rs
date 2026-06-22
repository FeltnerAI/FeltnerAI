use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use anyhow::Result;
use feltnerai_core::config::Config;
use feltnerai_server::{ServerCommand, backup, build_state, router};
use tokio::{
    net::TcpListener,
    sync::{Mutex, mpsc},
};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{
    EnvFilter, Layer, Registry, layer::SubscriberExt, util::SubscriberInitExt,
};

/// Initialise logging: always to the console, and additionally to a daily-rolled
/// file under `<data_dir>/logs` so failures (e.g. a provider that won't connect)
/// can be inspected after the fact. File logging is best-effort — if the
/// directory can't be created the server still starts with console logging.
///
/// The returned [`WorkerGuard`] must be held for the lifetime of the process;
/// dropping it flushes and stops the background file writer.
fn init_logging(config: &Config) -> Result<Option<WorkerGuard>> {
    let mut layers: Vec<Box<dyn Layer<Registry> + Send + Sync>> = Vec::new();

    let console = if config.log_json {
        tracing_subscriber::fmt::layer()
            .json()
            .with_filter(EnvFilter::try_new(&config.log_filter)?)
            .boxed()
    } else {
        tracing_subscriber::fmt::layer()
            .with_filter(EnvFilter::try_new(&config.log_filter)?)
            .boxed()
    };
    layers.push(console);

    let log_dir = config.data_dir.join("logs");
    let guard = match std::fs::create_dir_all(&log_dir) {
        Ok(()) => {
            let appender = tracing_appender::rolling::daily(&log_dir, "feltnerai.log");
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let file = if config.log_json {
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_ansi(false)
                    .with_writer(writer)
                    .with_filter(EnvFilter::try_new(&config.log_filter)?)
                    .boxed()
            } else {
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(writer)
                    .with_filter(EnvFilter::try_new(&config.log_filter)?)
                    .boxed()
            };
            layers.push(file);
            Some(guard)
        }
        Err(error) => {
            eprintln!(
                "warning: file logging disabled; could not create {}: {error}",
                log_dir.display()
            );
            None
        }
    };

    tracing_subscriber::registry().with(layers).init();
    Ok(guard)
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    let _log_guard = init_logging(&config)?;
    if _log_guard.is_some() {
        tracing::info!(
            log_dir = %config.data_dir.join("logs").display(),
            "file logging enabled"
        );
    }

    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let control_rx = Arc::new(Mutex::new(control_rx));

    loop {
        if backup::apply_pending_restore(&config.data_dir).await? {
            tracing::info!("imported backup applied successfully");
        }
        let bind = config.bind;
        let state = build_state(config.clone())
            .await?
            .with_control(control_tx.clone());
        if let Some(token) = &state.setup_token {
            tracing::warn!(
                setup_token = %token,
                "first-run setup is enabled; this token is regenerated whenever the server restarts"
            );
        }
        let listener = TcpListener::bind(bind).await?;
        tracing::info!(
            address = %bind,
            data_dir = %config.data_dir.display(),
            "FeltnerAI server listening"
        );
        let requested = Arc::new(AtomicU8::new(0));
        axum::serve(
            listener,
            router(state.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal(
            Arc::clone(&control_rx),
            Arc::clone(&requested),
        ))
        .await?;
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&state.pool)
            .await;
        state.pool.close().await;
        if requested.load(Ordering::SeqCst) != 2 {
            break;
        }
        tracing::info!("restarting FeltnerAI to apply imported data");
    }

    Ok(())
}

async fn shutdown_signal(
    control: Arc<Mutex<mpsc::UnboundedReceiver<ServerCommand>>>,
    requested: Arc<AtomicU8>,
) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
        ServerCommand::Exit
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
        ServerCommand::Exit
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<ServerCommand>();
    let command = tokio::select! {
        command = ctrl_c => command,
        command = terminate => command,
        command = async { control.lock().await.recv().await } => {
            command.unwrap_or(ServerCommand::Exit)
        },
    };
    requested.store(
        match command {
            ServerCommand::Exit => 1,
            ServerCommand::Restart => 2,
        },
        Ordering::SeqCst,
    );
}
