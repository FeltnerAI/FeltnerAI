use std::{
    convert::Infallible,
    io::{Cursor, Read},
    net::SocketAddr,
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::ConnectInfo,
    http::{Method, Request, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
    routing::{get, post},
};
use feltnerai_core::{config::Config, db};
use feltnerai_server::{build_state, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tower::ServiceExt;

struct Harness {
    app: Router,
    data: TempDir,
    setup_token: String,
}

impl Harness {
    async fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let config = Config {
            data_dir: data.path().to_owned(),
            bind: "127.0.0.1:0".parse().unwrap(),
            public_url: None,
            log_filter: "off".into(),
            log_json: false,
            trusted_proxies: vec![],
        };
        let state = build_state(config).await.unwrap();
        let setup_token = state.setup_token.as_ref().unwrap().to_string();
        Self {
            app: router(state),
            data,
            setup_token,
        }
    }

    async fn request(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
        bearer: Option<&str>,
        setup: bool,
    ) -> Response {
        let content_type = body.as_ref().map(|_| "application/json");
        self.request_bytes(
            method,
            uri,
            body.map(|value| value.to_string().into_bytes()),
            content_type,
            bearer,
            setup,
        )
        .await
    }

    async fn request_bytes(
        &self,
        method: Method,
        uri: &str,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
        bearer: Option<&str>,
        setup: bool,
    ) -> Response {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(content_type) = content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        if let Some(token) = bearer {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if setup {
            builder = builder.header("x-setup-token", &self.setup_token);
        }
        let mut request = builder
            .body(body.map_or_else(Body::empty, Body::from))
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:40000".parse::<SocketAddr>().unwrap(),
        ));
        self.app.clone().oneshot(request).await.unwrap()
    }

    async fn json(response: Response) -> Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }
}

async fn mock_provider() -> (String, tokio::task::JoinHandle<()>) {
    let app = Router::new()
        .route(
            "/v1/models",
            get(|| async {
                Json(json!({
                    "data": [
                        {"id": "good-model"},
                        {"id": "malformed-model"},
                        {"id": "failure-model"},
                        {"id": "slow-model"}
                    ]
                }))
            }),
        )
        .route("/v1/chat/completions", post(mock_chat));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/v1"), task)
}

async fn mock_chat(Json(request): Json<Value>) -> Response {
    match request["model"].as_str().unwrap_or_default() {
        "good-model" => (
            [(header::CONTENT_TYPE, "text/event-stream")],
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n\
             data: [DONE]\n\n",
        )
            .into_response(),
        "malformed-model" => (
            [(header::CONTENT_TYPE, "text/event-stream")],
            "data: {not-json}\n\ndata: [DONE]\n\n",
        )
            .into_response(),
        "failure-model" => StatusCode::BAD_GATEWAY.into_response(),
        "slow-model" => {
            let stream = async_stream::stream! {
                for index in 0..10 {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    yield Ok::<Event, Infallible>(
                        Event::default().data(format!(
                            "{{\"choices\":[{{\"delta\":{{\"content\":\"{index}\"}}}}]}}"
                        )),
                    );
                }
            };
            Sse::new(stream).into_response()
        }
        _ => StatusCode::BAD_REQUEST.into_response(),
    }
}

async fn setup_and_login(harness: &Harness, provider_url: &str) -> String {
    let response = harness
        .request(
            Method::POST,
            "/api/v1/setup/complete",
            Some(json!({
                "server_name": "Integration Test",
                "username": "admin",
                "email": "admin@example.com",
                "password": "correct horse battery staple",
                "provider": {
                    "name": "Mock",
                    "base_url": provider_url,
                    "api_key": "super-secret-provider-key",
                    "additional_headers": {"X-Secret-Tenant": "tenant-secret"}
                }
            })),
            None,
            true,
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    login(harness, "admin", "correct horse battery staple").await
}

async fn login(harness: &Harness, name: &str, password: &str) -> String {
    let response = harness
        .request(
            Method::POST,
            "/api/v1/auth/login",
            Some(json!({"login": name, "password": password, "portal": true})),
            None,
            false,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    Harness::json(response).await["bearer_token"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn configure_model(
    harness: &Harness,
    bearer: &str,
    provider_id: &str,
    upstream_id: &str,
    is_default: bool,
) -> String {
    let response = harness
        .request(
            Method::POST,
            &format!("/api/v1/admin/providers/{provider_id}/models"),
            Some(json!({
                "upstream_id": upstream_id,
                "display_name": upstream_id,
                "enabled": true,
                "is_default": is_default
            })),
            Some(bearer),
            false,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    Harness::json(response).await["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn create_chat(harness: &Harness, bearer: &str, model_id: &str) -> String {
    let response = harness
        .request(
            Method::POST,
            "/api/v1/chats",
            Some(json!({"title": "Test chat", "model_id": model_id})),
            Some(bearer),
            false,
        )
        .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    Harness::json(response).await["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn full_server_workflow_enforces_security_and_streams() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::ERROR)
        .with_test_writer()
        .try_init();
    let (provider_url, provider_task) = mock_provider().await;
    let harness = Harness::new().await;
    let admin_token = setup_and_login(&harness, &provider_url).await;

    let preferences = harness
        .request(
            Method::PUT,
            "/api/v1/auth/preferences",
            Some(json!({"theme": "dark"})),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(preferences.status(), StatusCode::OK);
    assert_eq!(Harness::json(preferences).await["theme"], "dark");
    let persisted_preferences = harness
        .request(
            Method::GET,
            "/api/v1/auth/session",
            None,
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(Harness::json(persisted_preferences).await["theme"], "dark");

    let providers = harness
        .request(
            Method::GET,
            "/api/v1/admin/providers",
            None,
            Some(&admin_token),
            false,
        )
        .await;
    let provider_id = Harness::json(providers).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let discovered = harness
        .request(
            Method::POST,
            &format!("/api/v1/admin/providers/{provider_id}/test"),
            None,
            Some(&admin_token),
            false,
        )
        .await;
    let discovered = Harness::json(discovered).await;
    assert_eq!(discovered["ok"], true);
    assert_eq!(discovered["models"].as_array().unwrap().len(), 4);

    let good_model =
        configure_model(&harness, &admin_token, &provider_id, "good-model", true).await;
    let malformed_model = configure_model(
        &harness,
        &admin_token,
        &provider_id,
        "malformed-model",
        false,
    )
    .await;
    let failure_model =
        configure_model(&harness, &admin_token, &provider_id, "failure-model", false).await;
    let slow_model =
        configure_model(&harness, &admin_token, &provider_id, "slow-model", false).await;

    let chat_id = create_chat(&harness, &admin_token, &good_model).await;
    let response = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{chat_id}/generate"),
            Some(json!({
                "request_id": "018f0000-0000-7000-8000-000000000010",
                "content": "Say hello",
                "model_id": good_model
            })),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let stream = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(stream.contains("\"event\":\"delta\""));
    assert!(stream.contains("Hello "));
    assert!(stream.contains("world"));

    let messages = harness
        .request(
            Method::GET,
            &format!("/api/v1/chats/{chat_id}/messages"),
            None,
            Some(&admin_token),
            false,
        )
        .await;
    let messages = Harness::json(messages).await;
    assert_eq!(messages[1]["content"], "Hello world");
    assert_eq!(messages[1]["status"], "complete");

    let malformed_chat = create_chat(&harness, &admin_token, &malformed_model).await;
    let malformed = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{malformed_chat}/generate"),
            Some(json!({
                "request_id": "018f0000-0000-7000-8000-000000000011",
                "content": "Break",
                "model_id": malformed_model
            })),
            Some(&admin_token),
            false,
        )
        .await;
    let malformed_stream = String::from_utf8(
        malformed
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(malformed_stream.contains("\"event\":\"error\""));
    assert!(!malformed_stream.contains("super-secret-provider-key"));
    assert!(!malformed_stream.contains("tenant-secret"));

    let failure_chat = create_chat(&harness, &admin_token, &failure_model).await;
    let failed = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{failure_chat}/generate"),
            Some(json!({
                "request_id": "018f0000-0000-7000-8000-000000000013",
                "content": "Fail",
                "model_id": failure_model
            })),
            Some(&admin_token),
            false,
        )
        .await;
    let failure_stream = String::from_utf8(
        failed
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(failure_stream.contains("\"event\":\"error\""));
    assert!(!failure_stream.contains("super-secret-provider-key"));

    let slow_chat = create_chat(&harness, &admin_token, &slow_model).await;
    let slow_response = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{slow_chat}/generate"),
            Some(json!({
                "request_id": "018f0000-0000-7000-8000-000000000012",
                "content": "Count",
                "model_id": slow_model
            })),
            Some(&admin_token),
            false,
        )
        .await;
    let collector = tokio::spawn(async move {
        slow_response.into_body().collect().await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    let stopped = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{slow_chat}/stop"),
            None,
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(stopped.status(), StatusCode::NO_CONTENT);
    collector.await.unwrap();
    let slow_messages = harness
        .request(
            Method::GET,
            &format!("/api/v1/chats/{slow_chat}/messages"),
            None,
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(Harness::json(slow_messages).await[1]["status"], "canceled");

    let disconnected_chat = create_chat(&harness, &admin_token, &slow_model).await;
    let disconnected = harness
        .request(
            Method::POST,
            &format!("/api/v1/chats/{disconnected_chat}/generate"),
            Some(json!({
                "request_id": "018f0000-0000-7000-8000-000000000014",
                "content": "Disconnect",
                "model_id": slow_model
            })),
            Some(&admin_token),
            false,
        )
        .await;
    drop(disconnected);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let disconnected_messages = harness
        .request(
            Method::GET,
            &format!("/api/v1/chats/{disconnected_chat}/messages"),
            None,
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(
        Harness::json(disconnected_messages).await[1]["status"],
        "canceled"
    );

    let duplicate = harness
        .request(
            Method::POST,
            "/api/v1/admin/users",
            Some(json!({
                "username": "admin",
                "email": "other@example.com",
                "password": "temporary password 123",
                "role": "user"
            })),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let demote_final_admin = harness
        .request(
            Method::PATCH,
            &format!(
                "/api/v1/admin/users/{}",
                Harness::json(
                    harness
                        .request(
                            Method::GET,
                            "/api/v1/auth/session",
                            None,
                            Some(&admin_token),
                            false,
                        )
                        .await
                )
                .await["id"]
                    .as_str()
                    .unwrap()
            ),
            Some(json!({"role": "user"})),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(demote_final_admin.status(), StatusCode::CONFLICT);

    let created_user = harness
        .request(
            Method::POST,
            "/api/v1/admin/users",
            Some(json!({
                "username": "second",
                "email": "second@example.com",
                "password": "temporary password 123",
                "role": "user"
            })),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(created_user.status(), StatusCode::CREATED);
    let second_user = Harness::json(created_user).await;
    let second_token = login(&harness, "second", "temporary password 123").await;
    let changed = harness
        .request(
            Method::PUT,
            "/api/v1/auth/password",
            Some(json!({
                "current_password": "temporary password 123",
                "new_password": "second user permanent password"
            })),
            Some(&second_token),
            false,
        )
        .await;
    assert_eq!(changed.status(), StatusCode::NO_CONTENT);

    let isolated = harness
        .request(
            Method::GET,
            &format!("/api/v1/chats/{chat_id}"),
            None,
            Some(&second_token),
            false,
        )
        .await;
    assert_eq!(isolated.status(), StatusCode::NOT_FOUND);

    let reset = harness
        .request(
            Method::PATCH,
            &format!(
                "/api/v1/admin/users/{}",
                second_user["id"].as_str().unwrap()
            ),
            Some(json!({"replacement_password": "replacement password 456"})),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(reset.status(), StatusCode::OK);
    let revoked = harness
        .request(
            Method::GET,
            "/api/v1/auth/session",
            None,
            Some(&second_token),
            false,
        )
        .await;
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);

    let mut state = 0x9e37_79b9_u32;
    let large_logo = (0..3 * 1024 * 1024)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect::<Vec<_>>();
    let pool = db::connect(harness.data.path()).await.unwrap();
    sqlx::query(
        "UPDATE server_settings
         SET logo_data = ?, logo_mime = 'image/png'
         WHERE singleton = 1",
    )
    .bind(large_logo)
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let exported = harness
        .request(
            Method::GET,
            "/api/v1/admin/data/export",
            None,
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(exported.status(), StatusCode::OK);
    assert_eq!(exported.headers()[header::CONTENT_TYPE], "application/zip");
    let backup = exported.into_body().collect().await.unwrap().to_bytes();
    assert!(backup.len() > 2 * 1024 * 1024);
    let mut archive = zip::ZipArchive::new(Cursor::new(backup.as_ref())).unwrap();
    assert_eq!(archive.len(), 3);
    let mut manifest = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    assert!(manifest.contains("\"application\": \"FeltnerAI\""));
    assert_eq!(archive.by_name("encryption.key").unwrap().size(), 32);

    let boundary = "feltnerai-integration-boundary";
    let mut multipart = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"backup\"; filename=\"backup.zip\"\r\nContent-Type: application/zip\r\n\r\n"
    )
    .into_bytes();
    multipart.extend_from_slice(backup.as_ref());
    multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let imported = harness
        .request_bytes(
            Method::POST,
            "/api/v1/admin/data/import",
            Some(multipart),
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Some(&admin_token),
            false,
        )
        .await;
    assert_eq!(imported.status(), StatusCode::OK);
    assert_eq!(Harness::json(imported).await["restart_required"], true);
    assert!(
        harness
            .data
            .path()
            .join(".restore-pending/feltnerai.db")
            .is_file()
    );

    provider_task.abort();
}
