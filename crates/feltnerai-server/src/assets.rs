use axum::{
    body::Body,
    extract::Path,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "$FELTNERAI_EMBED_DIR"]
struct Frontend;

pub async fn frontend(Path(path): Path<String>) -> Response {
    let path = path.trim_start_matches('/');
    let requested = if path.is_empty() { "index.html" } else { path };
    if let Some(asset) = Frontend::get(requested) {
        return asset_response(requested, asset.data.into_owned());
    }
    if !requested.contains('.')
        && let Some(index) = Frontend::get("index.html")
    {
        return asset_response("index.html", index.data.into_owned());
    }
    StatusCode::NOT_FOUND.into_response()
}

pub async fn index() -> Response {
    frontend(Path(String::new())).await
}

fn asset_response(path: &str, data: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path == "index.html" {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    };
    Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(data))
        .expect("valid static response")
}
