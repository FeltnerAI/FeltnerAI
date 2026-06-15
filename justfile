set shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

dev:
    bun run --cwd frontend dev

server:
    cargo run -p feltnerai-server

generate-api:
    cargo run -p feltnerai-api-types --example generate_ts
    bun run --cwd frontend format:api

format:
    cargo fmt --all
    bun run --cwd frontend format

check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo test --workspace
    bun run --cwd frontend check
    bun run --cwd frontend test
    bun run --cwd frontend build

test:
    cargo test --workspace
    bun run --cwd frontend test

e2e:
    bun run --cwd frontend test:e2e

build:
    bun run --cwd frontend build
    cargo build --release -p feltnerai-server

portal:
    bun run --cwd frontend tauri build
