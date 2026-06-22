set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

[group('dev')]
[unix]
setup:
    bash scripts/setup.sh

[group('dev')]
[windows]
setup:
    & scripts/setup.ps1

[group('dev')]
dev:
    bun run --cwd frontend dev

[group('dev')]
server:
    cargo run -p feltnerai-server

[group('check')]
check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo test --workspace
    bun run --cwd frontend check
    bun run --cwd frontend test
    bun run --cwd frontend build

[group('check')]
test:
    cargo test --workspace
    bun run --cwd frontend test

[group('codegen')]
generate-api:
    cargo run -p feltnerai-api-types --example generate_ts
    bun run --cwd frontend format:api

[group('codegen')]
format:
    cargo fmt --all
    bun run --cwd frontend format

[group('build')]
build:
    bun run --cwd frontend build
    cargo build --release -p feltnerai-server
    cargo build --release -p feltnerai-tray

# Setting CI keeps Tauri's macOS DMG bundler from running the AppleScript that
# opens the mounted disk image in Finder mid-build; the .dmg is still produced.
[group('build')]
[unix]
portal:
    CI=true bun run --cwd frontend tauri build

[group('build')]
[windows]
portal:
    bun run --cwd frontend tauri build

# `bun run` executes scripts in Bun's own shell, so the frontend clean step is
# cross-platform without needing a separate Windows recipe.
[group('build')]
clean:
    cargo clean
    bun run --cwd frontend clean
