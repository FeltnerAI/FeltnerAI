# FeltnerAI

FeltnerAI is a private, self-hosted chat server for OpenAI-compatible providers. It ships a standalone Rust server, a shared React web application, and a Tauri v2 desktop Portal for connecting to multiple servers.

## Features

- Console-token-protected first-run setup
- Administrator-created user accounts with forced password changes
- Argon2id passwords, hashed opaque sessions, CSRF protection, and encrypted provider secrets
- Generic OpenAI-compatible providers with model discovery
- Saved, user-owned chats with normalized SSE streaming, stop, and regeneration
- User, provider, model, server, and branding administration
- Per-account light, dark, and system theme preferences
- Admin ZIP backup/restore and Windows start-at-login controls
- Windows tray launcher (`feltnerai-tray`) that runs the server without a console window
- Browser and Windows/macOS/Linux Portal clients from one React bundle
- SQLite WAL storage in the operating system's persistent user-data directory

## Quick Start

Requirements: Rust 1.96+, Bun 1.3+, and `just`. Run `just setup` to install project dependencies and verify system prerequisites.

```powershell
just setup
bun run --cwd frontend build
cargo run -p feltnerai-server
```

Open `http://127.0.0.1:8080`. The server prints a temporary setup token on startup. The token changes on restart and is permanently disabled after setup.

For local development, run the server and Vite separately:

```powershell
just server
just dev
```

Vite serves `http://127.0.0.1:5173` and proxies `/api` to the server.

## Commands

```text
just setup        Install project deps and verify system prerequisites
just generate-api  Generate tracked TypeScript API definitions
just format        Format Rust and frontend sources
just check         Run formatting, Clippy, Rust tests, frontend checks/tests/build
just e2e           Run Playwright browser flows
just build         Build the frontend and release server
just portal        Build Tauri installers for the current platform
```

See [deployment.md](docs/deployment.md), [development.md](docs/development.md), and [api.md](docs/api.md).

## Scope

v1 intentionally supports one SQLite-backed server process. Registration, invitations, email, 2FA, attachments, multimodal chat, branching, quotas, routing/fallback, personal API keys, Docker packaging, Postgres, and automatic Portal updates are not included.

## License

AGPL-3.0-only.
