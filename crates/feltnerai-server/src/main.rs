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
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    let filter = EnvFilter::try_new(&config.log_filter)?;
    if config.log_json {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
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
