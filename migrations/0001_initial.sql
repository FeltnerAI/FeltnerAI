PRAGMA foreign_keys = ON;

CREATE TABLE server_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    server_uuid TEXT NOT NULL UNIQUE,
    server_name TEXT NOT NULL,
    public_url TEXT,
    accent_color TEXT NOT NULL,
    default_theme TEXT NOT NULL CHECK (default_theme IN ('light', 'dark', 'system')),
    custom_css TEXT,
    logo_mime TEXT,
    logo_data BLOB,
    favicon_mime TEXT,
    favicon_data BLOB,
    trusted_proxies_json TEXT NOT NULL DEFAULT '[]',
    setup_complete INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    disabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT,
    encrypted_headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    upstream_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_id, upstream_id)
);
CREATE UNIQUE INDEX one_default_model_idx ON models(is_default) WHERE is_default = 1;

CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX chats_user_updated_idx ON chats(user_id, updated_at DESC);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'canceled', 'error')),
    sequence INTEGER NOT NULL,
    request_id TEXT,
    model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    provider_name TEXT,
    model_name TEXT,
    upstream_model_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(chat_id, sequence),
    UNIQUE(chat_id, request_id)
);
CREATE INDEX messages_chat_sequence_idx ON messages(chat_id, sequence);

CREATE TRIGGER prevent_last_admin_disable
BEFORE UPDATE OF disabled, role ON users
WHEN OLD.role = 'admin' AND OLD.disabled = 0
  AND (NEW.role != 'admin' OR NEW.disabled = 1)
  AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != OLD.id) = 0
BEGIN
  SELECT RAISE(ABORT, 'cannot remove final active administrator');
END;

CREATE TRIGGER prevent_last_admin_delete
BEFORE DELETE ON users
WHEN OLD.role = 'admin' AND OLD.disabled = 0
  AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != OLD.id) = 0
BEGIN
  SELECT RAISE(ABORT, 'cannot delete final active administrator');
END;

