use std::{
    sync::mpsc,
    thread::{self, JoinHandle},
};

use anyhow::{Context, Result};
use tokio::sync::mpsc::UnboundedSender;
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
};
use winit::platform::windows::EventLoopBuilderExtWindows;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy},
    window::WindowId,
};

use feltnerai_server::ServerCommand;

enum UserEvent {
    Menu(MenuEvent),
    Shutdown,
}

pub struct WindowsTray {
    proxy: EventLoopProxy<UserEvent>,
    thread: Option<JoinHandle<()>>,
}

impl WindowsTray {
    pub fn start(control: UnboundedSender<ServerCommand>, browser_url: String) -> Result<Self> {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("feltnerai-tray".into())
            .spawn(move || {
                let mut event_loop = EventLoop::<UserEvent>::with_user_event();
                event_loop.with_any_thread(true);
                let event_loop = match event_loop.build() {
                    Ok(event_loop) => event_loop,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };
                let proxy = event_loop.create_proxy();
                let menu_proxy = proxy.clone();
                MenuEvent::set_event_handler(Some(move |event| {
                    let _ = menu_proxy.send_event(UserEvent::Menu(event));
                }));
                if ready_tx.send(Ok(proxy)).is_err() {
                    return;
                }
                let mut application = TrayApplication {
                    tray: None,
                    open_item: None,
                    exit_item: None,
                    control,
                    browser_url,
                };
                if let Err(error) = event_loop.run_app(&mut application) {
                    tracing::error!(%error, "Windows tray event loop failed");
                }
                MenuEvent::set_event_handler::<fn(MenuEvent)>(None);
            })
            .context("failed to start the Windows tray thread")?;
        let proxy = ready_rx
            .recv()
            .context("Windows tray thread ended during startup")?
            .map_err(anyhow::Error::msg)?;
        Ok(Self {
            proxy,
            thread: Some(thread),
        })
    }

    pub fn shutdown(mut self) {
        let _ = self.proxy.send_event(UserEvent::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct TrayApplication {
    tray: Option<TrayIcon>,
    open_item: Option<MenuItem>,
    exit_item: Option<MenuItem>,
    control: UnboundedSender<ServerCommand>,
    browser_url: String,
}

impl TrayApplication {
    fn create_tray(&mut self) -> Result<()> {
        let image = image::load_from_memory(include_bytes!("../icons/icon.png"))
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
}

impl ApplicationHandler<UserEvent> for TrayApplication {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.tray.is_none()
            && let Err(error) = self.create_tray()
        {
            tracing::error!(%error, "failed to create the Windows tray icon");
            let _ = self.control.send(ServerCommand::Exit);
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
                if let Err(error) = webbrowser::open(&self.browser_url) {
                    tracing::error!(%error, "failed to open FeltnerAI in the browser");
                }
            }
            UserEvent::Menu(event)
                if self
                    .exit_item
                    .as_ref()
                    .is_some_and(|item| event.id == *item.id()) =>
            {
                let _ = self.control.send(ServerCommand::Exit);
                event_loop.exit();
            }
            UserEvent::Shutdown => event_loop.exit(),
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
