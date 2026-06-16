set shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

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

[group('check')]
e2e:
    bun run --cwd frontend test:e2e

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

[group('build')]
portal:
    bun run --cwd frontend tauri build

[group('build')]
clean:
    cargo clean
    if (Test-Path frontend/dist) { Remove-Item -Recurse -Force frontend/dist }
    if (Test-Path frontend/test-results) { Remove-Item -Recurse -Force frontend/test-results }
    if (Test-Path frontend/playwright-report) { Remove-Item -Recurse -Force frontend/playwright-report }
    if (Test-Path frontend/node_modules/.vite) { Remove-Item -Recurse -Force frontend/node_modules/.vite }
    Get-ChildItem frontend -Filter *.tsbuildinfo | Remove-Item -Force
