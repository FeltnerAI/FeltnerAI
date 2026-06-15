use std::collections::BTreeMap;

use anyhow::{Result, bail};
use url::Url;

const FORBIDDEN_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "proxy-authorization",
];

pub fn provider_base_url(value: &str) -> Result<String> {
    let mut url = Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("provider URL must use HTTP or HTTPS");
    }
    if url.host_str().is_none() || url.username() != "" || url.password().is_some() {
        bail!("provider URL must have a host and cannot contain credentials");
    }
    url.set_query(None);
    url.set_fragment(None);
    let normalized = url.as_str().trim_end_matches('/').to_owned();
    Ok(normalized)
}

pub fn public_url(value: &str) -> Result<String> {
    let url = Url::parse(value)?;
    if url.scheme() != "https" && !(url.scheme() == "http" && url.host_str() == Some("localhost")) {
        bail!("public URL must use HTTPS (HTTP is allowed only for localhost)");
    }
    if url.host_str().is_none() || url.username() != "" || url.password().is_some() {
        bail!("public URL is invalid");
    }
    Ok(value.trim_end_matches('/').to_owned())
}

pub fn additional_headers(headers: &BTreeMap<String, String>) -> Result<()> {
    if headers.len() > 20 {
        bail!("at most 20 additional headers are allowed");
    }
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if FORBIDDEN_HEADERS.contains(&lower.as_str()) || lower.starts_with("sec-") {
            bail!("header {name} is not allowed");
        }
        if !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            bail!("header {name} has an invalid name");
        }
        if value.len() > 4096 || value.contains(['\r', '\n']) {
            bail!("header {name} has an invalid value");
        }
    }
    Ok(())
}

pub fn username(value: &str) -> Result<String> {
    let value = value.trim();
    if !(3..=64).contains(&value.len()) {
        bail!("username must be between 3 and 64 characters");
    }
    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
    {
        bail!("username may contain only letters, numbers, dots, dashes, and underscores");
    }
    Ok(value.to_owned())
}

pub fn accent_color(value: &str) -> Result<String> {
    if value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        Ok(value.to_ascii_lowercase())
    } else {
        bail!("accent color must be a six-digit hex color")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_provider_urls() {
        assert_eq!(
            provider_base_url("https://example.com/v1/").unwrap(),
            "https://example.com/v1"
        );
        assert!(provider_base_url("file:///tmp/provider").is_err());
        assert!(provider_base_url("https://user:secret@example.com").is_err());
    }

    #[test]
    fn protects_sensitive_headers() {
        let mut headers = BTreeMap::new();
        headers.insert("Authorization".into(), "oops".into());
        assert!(additional_headers(&headers).is_err());
    }
}
