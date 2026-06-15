# API Overview

All client APIs are versioned under `/api/v1`.

## Public

- `GET /health`
- `GET /server`
- `GET /setup/status`
- `POST /setup/test-provider`
- `POST /setup/complete`
- `POST /auth/login`
- `GET /branding/logo`
- `GET /branding/favicon`
- `GET /branding/custom.css`

Setup mutations require `X-Setup-Token`. Browser login creates an HttpOnly session cookie and returns a CSRF token. Portal login returns an opaque bearer session token.

## Authenticated

- `POST /auth/logout`
- `GET /auth/session`
- `PUT /auth/password`
- `PUT /auth/preferences`
- `GET /models`
- Chat CRUD under `/chats`
- Message history at `/chats/{id}/messages`
- SSE generation, regeneration, and stop under `/chats/{id}`

Cookie-authenticated mutations require `X-CSRF-Token`. Bearer-authenticated Portal requests do not.

Generation accepts a client UUID and emits SSE events named `started`, `delta`, `completed`, and `error`. The JSON payload repeats the normalized `event` discriminator.

## Administration

- User management under `/admin/users`
- Provider management and connection tests under `/admin/providers`
- Model configuration under `/admin/providers/{id}/models` and `/admin/models`
- Server settings at `/admin/server`
- Full-data export and import at `/admin/data/export` and `/admin/data/import`
- Branding configuration and uploads under `/admin/branding`

The server has no user-facing OpenAI gateway and does not issue personal API keys.
