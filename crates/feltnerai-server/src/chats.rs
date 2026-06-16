use std::convert::Infallible;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use chrono::Utc;
use dashmap::mapref::entry::Entry;
use feltnerai_api_types::{
    Chat, CreateChatRequest, GenerateRequest, Message, MessageRole, MessageStatus, Model,
    StreamEvent, UpdateChatRequest,
};
use feltnerai_core::db::new_id;
use feltnerai_provider_openai::{ChatMessage, ProviderError};
use futures::StreamExt;
use sqlx::Row;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    admin::{fetch_models, load_provider_config},
    auth::{AuthSession, parse_uuid},
    error::{AppError, AppResult},
    state::AppState,
};

pub async fn available_models(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<Vec<Model>>> {
    require_password_changed(&session)?;
    Ok(Json(fetch_models(&state, true).await?))
}

#[derive(serde::Deserialize)]
pub struct AgentCompletionRequest {
    pub model_id: Uuid,
    /// OpenAI-style message array (system/user/assistant/tool), passed through.
    pub messages: Vec<serde_json::Value>,
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

/// Stateless, tool-capable chat completions for agent clients (FelterAI Code).
/// Resolves an enabled model to its provider and streams the upstream
/// OpenAI-compatible response (including tool calls) straight back to the caller.
pub async fn agent_completions(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<AgentCompletionRequest>,
) -> AppResult<Response> {
    require_password_changed(&session)?;
    let model = sqlx::query(
        "SELECT m.provider_id, m.upstream_id
         FROM models m JOIN providers p ON p.id = m.provider_id
         WHERE m.id = ? AND m.enabled = 1 AND p.enabled = 1",
    )
    .bind(request.model_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::conflict("The selected model is unavailable."))?;
    let provider_id = parse_uuid(model.try_get("provider_id")?)?;
    let upstream_model: String = model.try_get("upstream_id")?;
    let config = load_provider_config(&state, provider_id).await?;

    let mut body = serde_json::json!({
        "model": upstream_model,
        "messages": request.messages,
        "stream": true,
    });
    if let Some(temperature) = request.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(tools) = request.tools {
        body["tools"] = tools;
        body["tool_choice"] = serde_json::json!("auto");
    }

    let response = state
        .provider
        .open_completions(&config, body)
        .await
        .map_err(|error| {
            AppError::new(StatusCode::BAD_GATEWAY, "provider_error", error.to_string())
        })?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "text/event-stream"),
            (axum::http::header::CACHE_CONTROL, "no-cache"),
        ],
        axum::body::Body::from_stream(response.bytes_stream()),
    )
        .into_response())
}

pub async fn list_chats(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
) -> AppResult<Json<Vec<Chat>>> {
    require_password_changed(&session)?;
    let rows = sqlx::query(
        "SELECT id, title, model_id, created_at, updated_at FROM chats
         WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .bind(session.user.id.to_string())
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.iter()
            .map(chat_from_row)
            .collect::<AppResult<Vec<_>>>()?,
    ))
}

pub async fn create_chat(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Json(request): Json<CreateChatRequest>,
) -> AppResult<(StatusCode, Json<Chat>)> {
    require_password_changed(&session)?;
    if let Some(model_id) = request.model_id {
        ensure_model_enabled(&state, model_id).await?;
    }
    let id = new_id();
    let now = Utc::now();
    let title = request
        .title
        .unwrap_or_else(|| "New chat".into())
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    let title = if title.is_empty() {
        "New chat".into()
    } else {
        title
    };
    sqlx::query(
        "INSERT INTO chats (id, user_id, title, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(session.user.id.to_string())
    .bind(&title)
    .bind(request.model_id.map(|id| id.to_string()))
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(Chat {
            id,
            title,
            model_id: request.model_id,
            created_at: now,
            updated_at: now,
        }),
    ))
}

pub async fn get_chat(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
) -> AppResult<Json<Chat>> {
    require_password_changed(&session)?;
    Ok(Json(owned_chat(&state, session.user.id, chat_id).await?))
}

pub async fn update_chat(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
    Json(request): Json<UpdateChatRequest>,
) -> AppResult<Json<Chat>> {
    require_password_changed(&session)?;
    let current = owned_chat(&state, session.user.id, chat_id).await?;
    if let Some(model_id) = request.model_id {
        ensure_model_enabled(&state, model_id).await?;
    }
    let title = request
        .title
        .map(|value| value.trim().chars().take(200).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or(current.title);
    let model_id = request.model_id.or(current.model_id);
    sqlx::query("UPDATE chats SET title = ?, model_id = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(model_id.map(|id| id.to_string()))
        .bind(Utc::now())
        .bind(chat_id.to_string())
        .execute(&state.pool)
        .await?;
    Ok(Json(owned_chat(&state, session.user.id, chat_id).await?))
}

pub async fn delete_chat(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_password_changed(&session)?;
    owned_chat(&state, session.user.id, chat_id).await?;
    if let Some((_, cancellation)) = state.generations.remove(&chat_id) {
        cancellation.cancel();
    }
    sqlx::query("DELETE FROM chats WHERE id = ?")
        .bind(chat_id.to_string())
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_messages(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
) -> AppResult<Json<Vec<Message>>> {
    require_password_changed(&session)?;
    owned_chat(&state, session.user.id, chat_id).await?;
    Ok(Json(fetch_messages(&state, chat_id).await?))
}

pub async fn generate(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
    Json(request): Json<GenerateRequest>,
) -> AppResult<Response> {
    require_password_changed(&session)?;
    if request.content.trim().is_empty() || request.content.len() > 100_000 {
        return Err(AppError::bad_request(
            "Message content must be between 1 and 100,000 characters.",
        ));
    }
    let chat = owned_chat(&state, session.user.id, chat_id).await?;
    if let Some(existing) = duplicate_response(&state, chat_id, request.request_id).await? {
        return Ok(completed_sse(existing));
    }
    start_generation(state, chat, request, true).await
}

pub async fn regenerate(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
    Json(request): Json<GenerateRequest>,
) -> AppResult<Response> {
    require_password_changed(&session)?;
    let chat = owned_chat(&state, session.user.id, chat_id).await?;
    if let Some(existing) = duplicate_response(&state, chat_id, request.request_id).await? {
        return Ok(completed_sse(existing));
    }
    if state.generations.contains_key(&chat_id) {
        return Err(AppError::conflict(
            "A generation is already active for this chat.",
        ));
    }
    let latest = sqlx::query(
        "SELECT id, role, sequence FROM messages WHERE chat_id = ? ORDER BY sequence DESC LIMIT 1",
    )
    .bind(chat_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::conflict("There is no assistant response to regenerate."))?;
    if latest.try_get::<String, _>("role")? != "assistant" {
        return Err(AppError::conflict(
            "The latest message is not an assistant response.",
        ));
    }
    sqlx::query("DELETE FROM messages WHERE id = ?")
        .bind(latest.try_get::<String, _>("id")?)
        .execute(&state.pool)
        .await?;
    start_generation(state, chat, request, false).await
}

pub async fn stop_generation(
    State(state): State<AppState>,
    Extension(session): Extension<AuthSession>,
    Path(chat_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_password_changed(&session)?;
    owned_chat(&state, session.user.id, chat_id).await?;
    if let Some(cancellation) = state.generations.get(&chat_id) {
        cancellation.cancel();
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn start_generation(
    state: AppState,
    chat: Chat,
    request: GenerateRequest,
    insert_user: bool,
) -> AppResult<Response> {
    let cancellation = CancellationToken::new();
    match state.generations.entry(chat.id) {
        Entry::Occupied(_) => {
            return Err(AppError::conflict(
                "A generation is already active for this chat.",
            ));
        }
        Entry::Vacant(entry) => {
            entry.insert(cancellation.clone());
        }
    }

    let prepared = prepare_generation(&state, &chat, &request, insert_user).await;
    let (assistant_id, provider_id, upstream_model, history) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            state.generations.remove(&chat.id);
            return Err(error);
        }
    };
    let provider_config = match load_provider_config(&state, provider_id).await {
        Ok(config) => config,
        Err(error) => {
            state.generations.remove(&chat.id);
            return Err(error);
        }
    };

    let (sender, receiver) = mpsc::channel::<Result<Event, Infallible>>(32);
    let worker_state = state.clone();
    let chat_id = chat.id;
    tokio::spawn(async move {
        let started = StreamEvent::Started {
            message_id: assistant_id,
        };
        if send_event(&sender, "started", &started).await.is_err() {
            cancellation.cancel();
        }

        let result = worker_state
            .provider
            .stream_chat(
                provider_config,
                upstream_model,
                history,
                cancellation.clone(),
            )
            .await;
        let mut content = String::new();
        let final_status = match result {
            Ok(mut stream) => {
                let mut status = "complete";
                while let Some(delta) = stream.next().await {
                    match delta {
                        Ok(delta) => {
                            // Some models emit leading newlines before their first
                            // token; drop them so the message does not render with
                            // a gap above its text on every client.
                            let delta = if content.is_empty() {
                                delta.trim_start().to_owned()
                            } else {
                                delta
                            };
                            if delta.is_empty() {
                                continue;
                            }
                            content.push_str(&delta);
                            if persist_assistant(&worker_state, assistant_id, &content, "streaming")
                                .await
                                .is_err()
                            {
                                status = "error";
                                break;
                            }
                            let event = StreamEvent::Delta { content: delta };
                            if send_event(&sender, "delta", &event).await.is_err() {
                                cancellation.cancel();
                                status = "canceled";
                                break;
                            }
                        }
                        Err(ProviderError::Canceled) => {
                            status = "canceled";
                            break;
                        }
                        Err(error) => {
                            tracing::warn!(chat_id = %chat_id, error = %error, "provider generation failed");
                            status = "error";
                            let event = StreamEvent::Error {
                                message: error.to_string(),
                            };
                            let _ = send_event(&sender, "error", &event).await;
                            break;
                        }
                    }
                }
                status
            }
            Err(error) => {
                tracing::warn!(chat_id = %chat_id, error = %error, "provider request failed");
                let event = StreamEvent::Error {
                    message: error.to_string(),
                };
                let _ = send_event(&sender, "error", &event).await;
                "error"
            }
        };

        let _ = persist_assistant(&worker_state, assistant_id, &content, final_status).await;
        if final_status != "error" {
            let completed = StreamEvent::Completed {
                message_id: assistant_id,
            };
            let _ = send_event(&sender, "completed", &completed).await;
        }
        worker_state.generations.remove(&chat_id);
    });

    Ok(Sse::new(ReceiverStream::new(receiver))
        .keep_alive(KeepAlive::default())
        .into_response())
}

type PreparedGeneration = (Uuid, Uuid, String, Vec<ChatMessage>);

async fn prepare_generation(
    state: &AppState,
    chat: &Chat,
    request: &GenerateRequest,
    insert_user: bool,
) -> AppResult<PreparedGeneration> {
    let model_id = if let Some(model_id) = request.model_id.or(chat.model_id) {
        model_id
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT m.id FROM models m JOIN providers p ON p.id = m.provider_id
             WHERE m.is_default = 1 AND m.enabled = 1 AND p.enabled = 1",
        )
        .fetch_optional(&state.pool)
        .await?
        .map(|value| Uuid::parse_str(&value))
        .transpose()
        .map_err(|error| AppError::internal(error.to_string()))?
        .ok_or_else(|| AppError::conflict("No enabled model is available."))?
    };
    let model = sqlx::query(
        "SELECT m.id, m.provider_id, m.upstream_id, m.display_name, p.name AS provider_name
         FROM models m JOIN providers p ON p.id = m.provider_id
         WHERE m.id = ? AND m.enabled = 1 AND p.enabled = 1",
    )
    .bind(model_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::conflict("The selected model is unavailable."))?;
    let provider_id = parse_uuid(model.try_get("provider_id")?)?;
    let upstream_model: String = model.try_get("upstream_id")?;
    let provider_name: String = model.try_get("provider_name")?;
    let model_name: String = model.try_get("display_name")?;

    let current_messages = fetch_messages(state, chat.id).await?;
    let next_sequence = current_messages.len() as i64;
    let assistant_id = new_id();
    let now = Utc::now();
    let mut transaction = state.pool.begin().await?;
    if insert_user {
        sqlx::query(
            "INSERT INTO messages
             (id, chat_id, role, content, status, sequence, request_id, model_id, created_at, updated_at)
             VALUES (?, ?, 'user', ?, 'complete', ?, ?, ?, ?, ?)",
        )
        .bind(new_id().to_string())
        .bind(chat.id.to_string())
        .bind(request.content.trim())
        .bind(next_sequence)
        .bind(request.request_id.to_string())
        .bind(model_id.to_string())
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
    }
    let assistant_sequence = if insert_user {
        next_sequence + 1
    } else {
        next_sequence
    };
    sqlx::query(
        "INSERT INTO messages
         (id, chat_id, role, content, status, sequence, request_id, model_id,
          provider_name, model_name, upstream_model_id, created_at, updated_at)
         VALUES (?, ?, 'assistant', '', 'streaming', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(assistant_id.to_string())
    .bind(chat.id.to_string())
    .bind(assistant_sequence)
    .bind((!insert_user).then(|| request.request_id.to_string()))
    .bind(model_id.to_string())
    .bind(&provider_name)
    .bind(&model_name)
    .bind(&upstream_model)
    .bind(now)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    if chat.title == "New chat" && insert_user {
        let title = request.content.trim().chars().take(60).collect::<String>();
        sqlx::query("UPDATE chats SET title = ?, model_id = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(model_id.to_string())
            .bind(now)
            .bind(chat.id.to_string())
            .execute(&mut *transaction)
            .await?;
    } else {
        sqlx::query("UPDATE chats SET model_id = ?, updated_at = ? WHERE id = ?")
            .bind(model_id.to_string())
            .bind(now)
            .bind(chat.id.to_string())
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;

    let mut history = current_messages
        .into_iter()
        .map(|message| ChatMessage {
            role: match message.role {
                MessageRole::User => "user".into(),
                MessageRole::Assistant => "assistant".into(),
            },
            content: message.content,
        })
        .collect::<Vec<_>>();
    if insert_user {
        history.push(ChatMessage {
            role: "user".into(),
            content: request.content.trim().into(),
        });
    }
    Ok((assistant_id, provider_id, upstream_model, history))
}

async fn duplicate_response(
    state: &AppState,
    chat_id: Uuid,
    request_id: Uuid,
) -> AppResult<Option<Uuid>> {
    let row =
        sqlx::query("SELECT sequence FROM messages WHERE chat_id = ? AND request_id = ? LIMIT 1")
            .bind(chat_id.to_string())
            .bind(request_id.to_string())
            .fetch_optional(&state.pool)
            .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let sequence: i64 = row.try_get("sequence")?;
    let id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM messages WHERE chat_id = ? AND role = 'assistant' AND sequence >= ?
         ORDER BY sequence LIMIT 1",
    )
    .bind(chat_id.to_string())
    .bind(sequence)
    .fetch_optional(&state.pool)
    .await?;
    id.map(|value| Uuid::parse_str(&value))
        .transpose()
        .map_err(|error| AppError::internal(error.to_string()))
}

fn completed_sse(message_id: Uuid) -> Response {
    let events = vec![
        Ok::<_, Infallible>(event("started", &StreamEvent::Started { message_id })),
        Ok(event("completed", &StreamEvent::Completed { message_id })),
    ];
    Sse::new(futures::stream::iter(events)).into_response()
}

async fn send_event(
    sender: &mpsc::Sender<Result<Event, Infallible>>,
    name: &'static str,
    value: &StreamEvent,
) -> Result<(), ()> {
    sender.send(Ok(event(name, value))).await.map_err(|_| ())
}

fn event(name: &'static str, value: &StreamEvent) -> Event {
    Event::default()
        .event(name)
        .json_data(value)
        .unwrap_or_else(|_| {
            Event::default()
                .event("error")
                .data(r#"{"event":"error","message":"serialization failed"}"#)
        })
}

async fn persist_assistant(
    state: &AppState,
    message_id: Uuid,
    content: &str,
    status: &str,
) -> AppResult<()> {
    sqlx::query("UPDATE messages SET content = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(content)
        .bind(status)
        .bind(Utc::now())
        .bind(message_id.to_string())
        .execute(&state.pool)
        .await?;
    Ok(())
}

async fn ensure_model_enabled(state: &AppState, model_id: Uuid) -> AppResult<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM models m JOIN providers p ON p.id = m.provider_id
           WHERE m.id = ? AND m.enabled = 1 AND p.enabled = 1
         )",
    )
    .bind(model_id.to_string())
    .fetch_one(&state.pool)
    .await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::bad_request("The selected model is unavailable."))
    }
}

async fn owned_chat(state: &AppState, user_id: Uuid, chat_id: Uuid) -> AppResult<Chat> {
    let row = sqlx::query(
        "SELECT id, title, model_id, created_at, updated_at FROM chats
         WHERE id = ? AND user_id = ?",
    )
    .bind(chat_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Chat not found."))?;
    chat_from_row(&row)
}

fn chat_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Chat> {
    Ok(Chat {
        id: parse_uuid(row.try_get("id")?)?,
        title: row.try_get("title")?,
        model_id: row
            .try_get::<Option<String>, _>("model_id")?
            .map(|value| Uuid::parse_str(&value))
            .transpose()
            .map_err(|error| AppError::internal(error.to_string()))?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn fetch_messages(state: &AppState, chat_id: Uuid) -> AppResult<Vec<Message>> {
    let rows = sqlx::query(
        "SELECT id, chat_id, role, content, status, model_id, provider_name, model_name, created_at
         FROM messages WHERE chat_id = ? ORDER BY sequence",
    )
    .bind(chat_id.to_string())
    .fetch_all(&state.pool)
    .await?;
    rows.iter().map(message_from_row).collect()
}

fn message_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Message> {
    let role = match row.try_get::<String, _>("role")?.as_str() {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        value => return Err(AppError::internal(format!("invalid message role: {value}"))),
    };
    let status = match row.try_get::<String, _>("status")?.as_str() {
        "complete" => MessageStatus::Complete,
        "streaming" => MessageStatus::Streaming,
        "canceled" => MessageStatus::Canceled,
        "error" => MessageStatus::Error,
        value => {
            return Err(AppError::internal(format!(
                "invalid message status: {value}"
            )));
        }
    };
    Ok(Message {
        id: parse_uuid(row.try_get("id")?)?,
        chat_id: parse_uuid(row.try_get("chat_id")?)?,
        role,
        content: row.try_get("content")?,
        status,
        model_id: row
            .try_get::<Option<String>, _>("model_id")?
            .map(|value| Uuid::parse_str(&value))
            .transpose()
            .map_err(|error| AppError::internal(error.to_string()))?,
        provider_name: row.try_get("provider_name")?,
        model_name: row.try_get("model_name")?,
        created_at: row.try_get("created_at")?,
    })
}

fn require_password_changed(session: &AuthSession) -> AppResult<()> {
    if session.user.must_change_password {
        Err(AppError::forbidden(
            "You must change your password before continuing.",
        ))
    } else {
        Ok(())
    }
}
