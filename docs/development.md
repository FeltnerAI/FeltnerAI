# Development

## Prerequisites

- Rust 1.96 or newer
- Bun 1.3 or newer
- `just`
- Platform prerequisites for Tauri v2

Run setup to install project dependencies and report missing system tools:

```powershell
just setup
```

Setup installs frontend packages and fetches Rust crates. On Linux it checks GTK/WebKit pkg-config modules needed for `just portal`. On Windows it checks WebView2 and MSVC build tools. On macOS it checks Xcode Command Line Tools.

## Run

Terminal 1:

```powershell
just server
```

Terminal 2:

```powershell
just dev
```

The development frontend runs at `http://127.0.0.1:5173`; Vite proxies API requests to `http://127.0.0.1:8080`.

Use a disposable data directory when testing setup repeatedly:

```powershell
$env:FELTNERAI_DATA_DIR="$PWD\target\dev-data"
cargo run -p feltnerai-server
```

## Shared API Types

Rust DTOs live in `crates/feltnerai-api-types`. Regenerate the tracked TypeScript contract after changing them:

```powershell
just generate-api
```

Review `frontend/src/api/generated.ts` in the same change.

## Verification

```powershell
just check
```

`just check` verifies Rust formatting and Clippy, runs workspace tests, type-checks and lints the frontend, runs Vitest, and builds the embedded frontend. Rust integration tests exercise the real Axum/SQLx server against an in-process OpenAI-compatible upstream.

## Portal

Run a development Portal:

```powershell
bun run --cwd frontend tauri dev
```

Build the current platform installer:

```powershell
just portal
```
