//! Small Windows wrapper that launches `feltnerai-server.exe` without a console
//! window and exposes a system-tray menu. The server binary remains the main
//! application; this tray is only a thin launcher around it.

use std::{
    net::SocketAddr,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
};
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::WindowId,
};

/// Launch the child server without allocating a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

enum UserEvent {
    Menu(MenuEvent),
    ServerExited,
}

pub fn run() -> Result<()> {
    let server = Arc::new(Mutex::new(
        spawn_server().context("failed to start the FeltnerAI server")?,
    ));
    let browser_url = browser_url();

    let event_loop = EventLoop::<UserEvent>::with_user_event()
        .build()
        .context("failed to create the tray event loop")?;
    let proxy = event_loop.create_proxy();
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = menu_proxy.send_event(UserEvent::Menu(event));
    }));

    // If the server stops on its own, close the tray too so the icon does not
    // linger pointing at a process that is no longer running.
    {
        let server = Arc::clone(&server);
        let proxy = proxy.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(750));
                let exited = match server.lock() {
                    Ok(mut child) => child
                        .try_wait()
                        .map(|status| status.is_some())
                        .unwrap_or(true),
                    Err(_) => true,
                };
                if exited {
                    let _ = proxy.send_event(UserEvent::ServerExited);
                    break;
                }
            }
        });
    }

    let mut application = TrayApplication {
        tray: None,
        open_item: None,
        exit_item: None,
        server: Arc::clone(&server),
        browser_url,
    };
    let result = event_loop
        .run_app(&mut application)
        .context("the tray event loop failed");
    MenuEvent::set_event_handler::<fn(MenuEvent)>(None);
    application.stop_server();
    result
}

fn spawn_server() -> Result<Child> {
    let executable = server_executable()?;
    Command::new(&executable)
        // Forward any arguments (such as `--startup`) so a tray launch behaves
        // exactly like running the server binary directly.
        .args(std::env::args_os().skip(1))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .with_context(|| format!("failed to launch {}", executable.display()))
}

fn server_executable() -> Result<PathBuf> {
    let current = std::env::current_exe().context("failed to resolve the tray executable path")?;
    let directory = current
        .parent()
        .context("the tray executable has no parent directory")?;
    let candidate = directory.join("feltnerai-server.exe");
    if !candidate.exists() {
        bail!(
            "FeltnerAI server executable was not found at {}",
            candidate.display()
        );
    }
    Ok(candidate)
}

fn browser_url() -> String {
    let bind = std::env::var("FELTNERAI_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    match bind.parse::<SocketAddr>() {
        Ok(address) => {
            let host = if address.ip().is_unspecified() {
                "127.0.0.1".to_string()
            } else if address.ip().is_ipv6() {
                format!("[{}]", address.ip())
            } else {
                address.ip().to_string()
            };
            format!("http://{host}:{}", address.port())
        }
        Err(_) => "http://127.0.0.1:8080".to_string(),
    }
}

struct TrayApplication {
    tray: Option<TrayIcon>,
    open_item: Option<MenuItem>,
    exit_item: Option<MenuItem>,
    server: Arc<Mutex<Child>>,
    browser_url: String,
}

impl TrayApplication {
    fn create_tray(&mut self) -> Result<()> {
        let image =
            image::load_from_memory(include_bytes!("../../feltnerai-server/icons/icon.png"))
                .context("failed to decode the server tray icon")?
                .into_rgba8();
        let (width, height) = image.dimensions();
        let icon = Icon::from_rgba(image.into_raw(), width, height)
            .context("failed to create the server tray icon")?;
        let menu = Menu::new();
        let open_item = MenuItem::with_id("open", "Open in browser", true, None);
        let separator = PredefinedMenuItem::separator();
        let exit_item = MenuItem::with_id("exit", "Exit", true, None);
        menu.append_items(&[&open_item, &separator, &exit_item])?;
        let tray = TrayIconBuilder::new()
            .with_tooltip("FeltnerAI Server")
            .with_icon(icon)
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .with_menu_on_right_click(true)
            .build()?;
        self.open_item = Some(open_item);
        self.exit_item = Some(exit_item);
        self.tray = Some(tray);
        Ok(())
    }

    fn stop_server(&self) {
        if let Ok(mut child) = self.server.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl ApplicationHandler<UserEvent> for TrayApplication {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.tray.is_none() && self.create_tray().is_err() {
            self.stop_server();
            event_loop.exit();
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Menu(event)
                if self
                    .open_item
                    .as_ref()
                    .is_some_and(|item| event.id == *item.id()) =>
            {
                let _ = webbrowser::open(&self.browser_url);
            }
            UserEvent::Menu(event)
                if self
                    .exit_item
                    .as_ref()
                    .is_some_and(|item| event.id == *item.id()) =>
            {
                self.stop_server();
                event_loop.exit();
            }
            UserEvent::ServerExited => event_loop.exit(),
            UserEvent::Menu(_) => {}
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}
