# Deployment

## Standalone Server

Build the React bundle before the server so it is embedded in the binary:

```powershell
bun install --cwd frontend --frozen-lockfile
bun run --cwd frontend build
cargo build --release -p feltnerai-server
```

The resulting `target/release/feltnerai-server` binary serves both `/api/v1` and the web application. On Windows it also runs a system-tray menu with **Open in browser** and **Exit** actions.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `FELTNERAI_DATA_DIR` | OS user data directory | Optional override for SQLite, encryption key, and persistent state |
| `FELTNERAI_BIND` | `127.0.0.1:8080` | Server listen address |
| `FELTNERAI_PUBLIC_URL` | unset | Canonical HTTPS URL; overrides the stored value at startup |
| `FELTNERAI_LOG` | `feltnerai=info,tower_http=info` | Rust tracing filter |
| `FELTNERAI_LOG_JSON` | `false` | Emit JSON logs |
| `FELTNERAI_TRUSTED_PROXIES` | unset | Comma-separated exact proxy IPs allowed to supply `X-Forwarded-For` |

Run only one FeltnerAI process against a data directory.

Without an override, FeltnerAI follows operating-system conventions:

- Windows: `%LOCALAPPDATA%\FeltnerAI\FeltnerAI Server\data`
- macOS: `~/Library/Application Support/ai.FeltnerAI.FeltnerAI-Server`
- Linux: `$XDG_DATA_HOME/feltnerai-server` or `~/.local/share/feltnerai-server`

When an upgraded server first starts with the new default, it looks for a legacy `data` directory beside the executable and in the working directory. If found, it copies that directory into the OS location and preserves the legacy copy as an extra safeguard.

On Windows, administrators can enable or disable **Open FeltnerAI Server when I sign in to Windows** from **Admin → Server**. This registers the current executable under the current user's standard Windows `Run` key.

## TLS Reverse Proxy

Terminate TLS at a reverse proxy and bind FeltnerAI to loopback. Example Caddy configuration:

```caddyfile
ai.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set:

```text
FELTNERAI_PUBLIC_URL=https://ai.example.com
FELTNERAI_TRUSTED_PROXIES=127.0.0.1
```

Do not trust broad proxy ranges unless every address in that range is controlled. FeltnerAI uses forwarded client addresses only when the immediate peer is explicitly trusted.

## Persistent Data And Backups

The data directory contains:

- `feltnerai.db`, plus temporary WAL/SHM files while running
- `encryption.key`, used to decrypt provider API keys and custom secret headers

Back up the database and `encryption.key` together. A database backup without its matching key cannot recover provider credentials. Protect backups as secrets.

Administrators can use **Admin → Server → Backup and restore** to:

- export a consistent online ZIP snapshot containing `feltnerai.db`, `encryption.key`, and a versioned manifest;
- import a compatible FeltnerAI ZIP after validation. The server stages the files, shuts down SQLite cleanly, keeps a rollback copy, applies the restore, and restarts.

For a consistent offline backup:

1. Stop the FeltnerAI process.
2. Copy the entire data directory.
3. Restart the process.

If online backup tooling is used, use SQLite's backup API or a tool that understands WAL mode; do not copy only the main `.db` file while the server is active.

## Portal Installers

Build on each target operating system:

```powershell
bun install --cwd frontend --frozen-lockfile
bun run --cwd frontend tauri build
```

Tauri emits platform installers under `target/release/bundle`. v1 has no in-app updater. Production signing and macOS notarization are release-operator responsibilities; unsigned development builds are supported.

Executable icon sources live at:

- `crates/feltnerai-server/icons/icon.ico` for the Windows server executable;
- `crates/feltnerai-server/icons/icon.png` for the Windows tray;
- `crates/feltnerai-portal/icons/icon.ico` and `icon.png` for Portal packaging.

Portal stores profiles in its application data directory and session credentials in the operating system credential manager. If secure storage is unavailable, the session remains in memory only and the user must sign in again after Portal closes.
