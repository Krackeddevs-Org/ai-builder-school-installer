//! Live gateway client — validates the key and fetches the model list.
//!
//! Verified behaviour of the gateway: `GET /v1/models` returns 401 with a JSON error
//! body when no key is supplied, so the model list is only available AFTER key entry.

use serde::{Deserialize, Serialize};

pub const DEFAULT_BASE_URL: &str = "https://litellm.rapidscreen.io/v1";
/// The model students get by default. Cheap, fast, capable enough for the course.
pub const DEFAULT_MODEL: &str = "deepseek-v4.1-flash";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsResponse {
    pub data: Vec<ModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub owned_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub models: Vec<String>,
    pub message: String,
    /// Latency in ms for the models round-trip.
    pub latency_ms: u128,
}

fn http_get(url: &str, api_key: &str) -> Result<(u16, String), String> {
    // Minimal HTTP over a child process keeps the dependency surface tiny AND avoids
    // TLS/openssl build requirements on every student machine. curl ships on Windows 10+,
    // macOS and virtually every Linux, and we fall back to a pure-Rust path if absent.
    let out = crate::platform::command("curl")
        .args([
            "-sS",
            "-m",
            "25",
            "-w",
            "\n__HTTP_CODE__%{http_code}",
            "-H",
            &format!("Authorization: Bearer {api_key}"),
            "-H",
            "Accept: application/json",
            url,
        ])
        .output();

    match out {
        Ok(o) => {
            let body = String::from_utf8_lossy(&o.stdout).to_string();
            if let Some(idx) = body.rfind("__HTTP_CODE__") {
                let (content, code) = body.split_at(idx);
                let code: u16 = code
                    .trim_start_matches("__HTTP_CODE__")
                    .trim()
                    .parse()
                    .unwrap_or(0);
                if code == 0 {
                    return Err(format!(
                        "could not reach the gateway. curl said: {}",
                        String::from_utf8_lossy(&o.stderr).trim()
                    ));
                }
                Ok((code, content.trim().to_string()))
            } else if !o.status.success() {
                Err(format!(
                    "network request failed: {}",
                    String::from_utf8_lossy(&o.stderr).trim()
                ))
            } else {
                Ok((200, body.trim().to_string()))
            }
        }
        Err(_) => Err(
            "curl is not available on this system, so the wizard cannot verify your key online. \
             You can still continue — the API key will be saved."
                .into(),
        ),
    }
}

/// Validate the key and return the model list.
pub fn verify_and_list(base_url: &str, api_key: &str) -> Result<VerifyResult, String> {
    if api_key.trim().is_empty() {
        return Err("Please enter your API key first.".into());
    }
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let started = std::time::Instant::now();
    let (code, body) = http_get(&url, api_key.trim())?;
    let latency_ms = started.elapsed().as_millis();

    if code == 401 || code == 403 {
        return Err("That API key was rejected (401). Check you copied the whole key from your KrackedDevs profile.".into());
    }
    if code != 200 {
        return Err(format!(
            "The gateway returned HTTP {code}. {}",
            body.chars().take(180).collect::<String>()
        ));
    }
    let parsed: ModelsResponse = serde_json::from_str(&body).map_err(|e| {
        format!(
            "Unexpected response format from the gateway: {e}. Body began: {}",
            body.chars().take(140).collect::<String>()
        )
    })?;
    if parsed.data.is_empty() {
        return Err("The gateway returned an empty model list.".into());
    }
    let mut models: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    models.sort();
    Ok(VerifyResult {
        ok: true,
        message: format!("Connected — {} models available.", models.len()),
        models,
        latency_ms,
    })
}

/// Pick the default model: the student's saved preference if present in the list,
/// else `DEFAULT_MODEL` if offered, else the first model presented.
pub fn choose_default(models: &[String], preferred: Option<&str>) -> Option<String> {
    if let Some(p) = preferred {
        if models.iter().any(|m| m == p) {
            return Some(p.to_string());
        }
    }
    if models.iter().any(|m| m == DEFAULT_MODEL) {
        return Some(DEFAULT_MODEL.to_string());
    }
    models.first().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_default_prefers_saved_choice() {
        let models = vec!["a".into(), DEFAULT_MODEL.into(), "b".into()];
        assert_eq!(
            choose_default(&models, Some(DEFAULT_MODEL)).unwrap(),
            DEFAULT_MODEL
        );
    }

    #[test]
    fn choose_default_falls_back_to_aibs_default() {
        let models = vec!["zzz".into(), DEFAULT_MODEL.into(), "aaa".into()];
        assert_eq!(choose_default(&models, None).unwrap(), DEFAULT_MODEL);
    }

    #[test]
    fn choose_default_falls_back_to_first_when_default_missing() {
        let models = vec!["zzz".into(), "aaa".into()];
        assert_eq!(choose_default(&models, None).unwrap(), "zzz");
    }

    #[test]
    fn choose_default_ignores_saved_choice_no_longer_offered() {
        let models = vec!["a".into(), DEFAULT_MODEL.into()];
        assert_eq!(
            choose_default(&models, Some("removed-model")).unwrap(),
            DEFAULT_MODEL
        );
    }

    #[test]
    fn choose_default_handles_empty_list() {
        assert!(choose_default(&[], None).is_none());
    }

    #[test]
    fn empty_key_is_rejected_before_network() {
        let err = verify_and_list(DEFAULT_BASE_URL, "   ").unwrap_err();
        assert!(err.contains("enter your API key"));
    }

    #[test]
    fn models_response_parses_gateway_shape() {
        let body = r#"{"data":[{"id":"gpt-5.5","object":"model"},{"id":"deepseek-v4.1-flash"}]}"#;
        let r: ModelsResponse = serde_json::from_str(body).unwrap();
        assert_eq!(r.data.len(), 2);
        assert_eq!(r.data[1].id, "deepseek-v4.1-flash");
    }
}
