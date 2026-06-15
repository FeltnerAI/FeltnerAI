use std::{collections::BTreeMap, pin::Pin};

use async_stream::try_stream;
use futures::{Stream, StreamExt};
use reqwest::{
    Client, StatusCode,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub additional_headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider rejected the request ({0})")]
    Http(StatusCode),
    #[error("provider returned an invalid response")]
    InvalidResponse,
    #[error("provider connection failed")]
    Connection,
    #[error("generation canceled")]
    Canceled,
}

#[derive(Clone)]
pub struct OpenAiProvider {
    client: Client,
}

impl OpenAiProvider {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()?,
        })
    }

    fn headers(config: &ProviderConfig) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        if let Some(api_key) = &config.api_key {
            let value = HeaderValue::from_str(&format!("Bearer {api_key}"))
                .map_err(|_| ProviderError::InvalidResponse)?;
            headers.insert(reqwest::header::AUTHORIZATION, value);
        }
        for (name, value) in &config.additional_headers {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| ProviderError::InvalidResponse)?,
                HeaderValue::from_str(value).map_err(|_| ProviderError::InvalidResponse)?,
            );
        }
        Ok(headers)
    }

    pub async fn models(&self, config: &ProviderConfig) -> Result<Vec<String>, ProviderError> {
        #[derive(Deserialize)]
        struct ModelList {
            data: Vec<ModelItem>,
        }
        #[derive(Deserialize)]
        struct ModelItem {
            id: String,
        }

        let response = self
            .client
            .get(format!("{}/models", config.base_url))
            .headers(Self::headers(config)?)
            .send()
            .await
            .map_err(|_| ProviderError::Connection)?;
        if !response.status().is_success() {
            return Err(ProviderError::Http(response.status()));
        }
        let mut models = response
            .json::<ModelList>()
            .await
            .map_err(|_| ProviderError::InvalidResponse)?
            .data
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();
        models.sort();
        models.dedup();
        Ok(models)
    }

    pub async fn stream_chat(
        &self,
        config: ProviderConfig,
        model: String,
        messages: Vec<ChatMessage>,
        cancellation: CancellationToken,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<String, ProviderError>> + Send>>, ProviderError>
    {
        let response = self
            .client
            .post(format!("{}/chat/completions", config.base_url))
            .headers(Self::headers(&config)?)
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true
            }))
            .send()
            .await
            .map_err(|_| ProviderError::Connection)?;
        if !response.status().is_success() {
            return Err(ProviderError::Http(response.status()));
        }

        let mut bytes = response.bytes_stream();
        let output = try_stream! {
            let mut buffer = String::new();
            loop {
                let chunk = tokio::select! {
                    _ = cancellation.cancelled() => Err(ProviderError::Canceled),
                    chunk = bytes.next() => Ok(chunk),
                }?;
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|_| ProviderError::Connection)?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(position) = buffer.find('\n') {
                    let line = buffer[..position].trim_end_matches('\r').to_owned();
                    buffer.drain(..=position);
                    if let Some(data) = line.strip_prefix("data:") {
                        let data = data.trim();
                        if data == "[DONE]" {
                            return;
                        }
                        if data.is_empty() {
                            continue;
                        }
                        let payload: ChatChunk =
                            serde_json::from_str(data).map_err(|_| ProviderError::InvalidResponse)?;
                        if let Some(content) = payload
                            .choices
                            .first()
                            .and_then(|choice| choice.delta.content.clone())
                        {
                            yield content;
                        }
                    }
                }
            }
        };
        Ok(Box::pin(output))
    }
}

#[derive(Debug, Deserialize)]
struct ChatChunk {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    delta: Delta,
}

#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_delta_shape() {
        let chunk: ChatChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{"content":"hello"}}]}"#).unwrap();
        assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("hello"));
    }

    #[test]
    fn accepts_role_only_chunks() {
        let chunk: ChatChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{"content":null,"role":"assistant"}}]}"#)
                .unwrap();
        assert!(chunk.choices[0].delta.content.is_none());
    }
}
