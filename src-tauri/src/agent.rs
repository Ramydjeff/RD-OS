//! rAImy Agent: the bridge between the UI and the Claude Messages API.
//!
//! * The API key never reaches the webview. It is read from `agent.json` in
//!   the config directory (written by `configure`) or, failing that, from the
//!   `ANTHROPIC_API_KEY` environment variable. The UI only ever sees a hint.
//! * The UI owns the conversation (system prompt, tools, messages) and the
//!   tool loop; the backend adds the model settings, sends the request and
//!   forwards every server-sent event (one JSON object each) through a channel.
//! * Commands proposed by the agent run here only after the user approved them
//!   in the UI, through `bash -lc` inside the chosen WSL distribution, with a
//!   timeout and the same output caps as every other captured process.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::logging;
use crate::wsl;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
/// Server-side refusal fallback ("default" form): the API retries a declined
/// request on the model Anthropic recommends for that category.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 64_000;
/// Largest request body accepted from the UI (conversation + tools).
const MAX_REQUEST_BYTES: usize = 24 * 1024 * 1024;
const MAX_ERROR_BODY: u64 = 64 * 1024;
const MAX_RETRIES: u32 = 2;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_COMMAND_LEN: usize = 16 * 1024;
/// Output returned to the model per stream; the rest is summarised.
const MAX_TOOL_OUTPUT: usize = 48 * 1024;

pub const MODELS: &[(&str, &str)] = &[
    ("claude-opus-5-5", "Claude Opus 5.5"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    ("claude-haiku-5-5", "Claude Haiku 5.5"),
];
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const DEFAULT_EFFORT: &str = "medium";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StoredConfig {
    api_key: Option<String>,
    model: Option<String>,
    effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub has_key: bool,
    /// "stored", "env" or "none".
    pub key_source: &'static str,
    /// First and last characters of the key, never the key itself.
    pub key_hint: Option<String>,
    pub model: String,
    pub effort: String,
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureRequest {
    /// `None`: keep the stored key; `Some("")`: forget it; otherwise replace it.
    pub api_key: Option<String>,
    pub model: String,
    pub effort: String,
}

/// Request sent by the UI for one model turn.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub request_id: String,
    pub system: Value,
    pub tools: Value,
    pub messages: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub truncated: bool,
}

pub struct AgentState {
    config_path: PathBuf,
    config: Mutex<StoredConfig>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn key_hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        return "•".repeat(chars.len().min(8));
    }
    let head: String = chars[..7].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

fn valid_key_shape(key: &str) -> bool {
    (20..=400).contains(&key.len()) && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn env_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

impl AgentState {
    pub fn new(config_dir: &Path) -> Self {
        let config_path = config_dir.join("agent.json");
        let config = fs::read(&config_path)
            .ok()
            .and_then(|b| serde_json::from_slice::<StoredConfig>(&b).ok())
            .unwrap_or_default();
        Self {
            config_path,
            config: Mutex::new(config),
            cancels: Mutex::new(HashMap::new()),
        }
    }

    fn snapshot(&self) -> StoredConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    fn api_key(&self) -> Option<(String, &'static str)> {
        if let Some(k) = self.snapshot().api_key.filter(|k| !k.is_empty()) {
            return Some((k, "stored"));
        }
        env_key().map(|k| (k, "env"))
    }

    fn model(&self) -> String {
        self.snapshot()
            .model
            .filter(|m| MODELS.iter().any(|(id, _)| id == m))
            .unwrap_or_else(|| DEFAULT_MODEL.to_string())
    }

    fn effort(&self) -> String {
        self.snapshot()
            .effort
            .filter(|e| EFFORTS.contains(&e.as_str()))
            .unwrap_or_else(|| DEFAULT_EFFORT.to_string())
    }

    pub fn status(&self) -> AgentStatus {
        let key = self.api_key();
        AgentStatus {
            has_key: key.is_some(),
            key_source: key.as_ref().map(|(_, s)| *s).unwrap_or("none"),
            key_hint: key.as_ref().map(|(k, _)| key_hint(k)),
            model: self.model(),
            effort: self.effort(),
            models: MODELS.iter().map(|(id, label)| ModelInfo { id, label }).collect(),
        }
    }

    pub fn configure(&self, req: ConfigureRequest) -> AppResult<AgentStatus> {
        if !MODELS.iter().any(|(id, _)| *id == req.model) {
            return Err(AppError::InvalidInput(format!("unknown model '{}'", req.model)));
        }
        if !EFFORTS.contains(&req.effort.as_str()) {
            return Err(AppError::InvalidInput(format!("unknown effort level '{}'", req.effort)));
        }
        let mut next = self.snapshot();
        match req.api_key.map(|k| k.trim().to_string()) {
            Some(k) if k.is_empty() => next.api_key = None,
            Some(k) if !valid_key_shape(&k) => {
                return Err(AppError::InvalidInput(
                    "this does not look like an Anthropic API key (expected something like sk-ant-...)".into(),
                ))
            }
            Some(k) => next.api_key = Some(k),
            None => {}
        }
        next.model = Some(req.model);
        next.effort = Some(req.effort);
        write_private(&self.config_path, &serde_json::to_vec_pretty(&next).unwrap_or_default())?;
        if let Ok(mut c) = self.config.lock() {
            *c = next;
        }
        Ok(self.status())
    }

    pub fn cancel(&self, request_id: &str) {
        if let Ok(map) = self.cancels.lock() {
            if let Some(flag) = map.get(request_id) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Sends one turn and forwards each event to `sink` until the stream ends.
    /// Returns `Ok(true)` when the stream completed, `Ok(false)` when cancelled.
    pub fn stream_turn(&self, req: TurnRequest, sink: &dyn Fn(Value) -> bool) -> AppResult<bool> {
        if req.request_id.is_empty() || req.request_id.len() > 64 {
            return Err(AppError::InvalidInput("invalid request id".into()));
        }
        let (key, _) = self
            .api_key()
            .ok_or_else(|| AppError::Agent("no API key configured: add one in rAImy Agent settings".into()))?;
        let model = self.model();
        let body = build_body(&model, &self.effort(), req.system, req.tools, req.messages);
        let body = serde_json::to_string(&body).map_err(|e| AppError::InvalidInput(e.to_string()))?;
        if body.len() > MAX_REQUEST_BYTES {
            return Err(AppError::InvalidInput("the conversation is too large; start a new one".into()));
        }

        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(req.request_id.clone(), cancel.clone());
        }
        let result = send_with_retries(&key, uses_fallback(&model), &body, &cancel, sink);
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(&req.request_id);
        }
        result
    }
}

fn uses_fallback(model: &str) -> bool {
    // Claude Haiku 5.5 has no server-side fallback.
    model != "claude-haiku-5-5"
}

fn build_body(model: &str, effort: &str, system: Value, tools: Value, messages: Value) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": system,
        "messages": messages,
        "thinking": { "type": "adaptive", "display": "summarized" },
        "output_config": { "effort": effort },
        // Caches the conversation prefix; each turn only pays for what is new.
        "cache_control": { "type": "ephemeral" },
    });
    if tools.as_array().is_some_and(|t| !t.is_empty()) {
        body["tools"] = tools;
    }
    if uses_fallback(model) {
        body["fallbacks"] = json!("default");
    }
    body
}

fn write_private(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP + server-sent events
// ---------------------------------------------------------------------------

enum Attempt {
    Done(bool),
    /// Failed before any event reached the UI; safe to retry after the delay.
    Retry(AppError, Duration),
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(180)))
        .build()
        .into()
}

fn send_with_retries(
    key: &str,
    fallback: bool,
    body: &str,
    cancel: &AtomicBool,
    sink: &dyn Fn(Value) -> bool,
) -> AppResult<bool> {
    let agent = http_agent();
    let mut attempt = 0;
    loop {
        match send_once(&agent, key, fallback, body, cancel, sink)? {
            Attempt::Done(completed) => return Ok(completed),
            Attempt::Retry(err, wait) => {
                attempt += 1;
                if attempt > MAX_RETRIES {
                    return Err(err);
                }
                logging::warn("agent", &format!("retrying after: {err}"));
                let deadline = Instant::now() + wait;
                while Instant::now() < deadline {
                    if cancel.load(Ordering::SeqCst) {
                        return Ok(false);
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }
}

fn retryable(status: u16) -> bool {
    matches!(status, 408 | 409 | 429 | 500 | 502 | 503 | 504 | 529)
}

fn send_once(
    agent: &ureq::Agent,
    key: &str,
    fallback: bool,
    body: &str,
    cancel: &AtomicBool,
    sink: &dyn Fn(Value) -> bool,
) -> AppResult<Attempt> {
    let mut req = agent
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream");
    if fallback {
        req = req.header("anthropic-beta", FALLBACK_BETA);
    }
    let mut resp = match req.send(body) {
        Ok(r) => r,
        Err(e) => {
            return Ok(Attempt::Retry(
                AppError::Agent(format!("could not reach api.anthropic.com: {e}")),
                Duration::from_secs(2),
            ))
        }
    };

    let status = resp.status().as_u16();
    if status != 200 {
        let wait = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .map(|s| Duration::from_secs(s.clamp(1, 30)))
            .unwrap_or(Duration::from_secs(3));
        let mut text = String::new();
        let _ = resp.body_mut().as_reader().take(MAX_ERROR_BODY).read_to_string(&mut text);
        let err = AppError::Agent(describe_http_error(status, &text));
        if retryable(status) {
            return Ok(Attempt::Retry(err, wait));
        }
        return Err(err);
    }

    let reader = BufReader::new(resp.body_mut().as_reader());
    let mut data = String::new();
    let mut delivered = false;
    for line in reader.lines() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(Attempt::Done(false));
        }
        let line = match line {
            Ok(l) => l,
            Err(e) if !delivered => {
                return Ok(Attempt::Retry(
                    AppError::Agent(format!("connection lost: {e}")),
                    Duration::from_secs(2),
                ))
            }
            Err(e) => return Err(AppError::Agent(format!("connection lost while streaming: {e}"))),
        };
        if line.is_empty() {
            // End of one event.
            if data.is_empty() {
                continue;
            }
            let event: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => {
                    data.clear();
                    continue;
                }
            };
            data.clear();
            if event["type"] == "ping" {
                continue;
            }
            if event["type"] == "error" {
                let kind = event["error"]["type"].as_str().unwrap_or("error").to_string();
                let message = event["error"]["message"].as_str().unwrap_or("").to_string();
                let transient = matches!(kind.as_str(), "overloaded_error" | "api_error" | "rate_limit_error");
                let err = AppError::Agent(format!("{kind}: {message}"));
                if transient && !delivered {
                    return Ok(Attempt::Retry(err, Duration::from_secs(3)));
                }
                return Err(err);
            }
            let is_stop = event["type"] == "message_stop";
            delivered = true;
            if !sink(event) {
                return Ok(Attempt::Done(false));
            }
            if is_stop {
                return Ok(Attempt::Done(true));
            }
        } else if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
        // `event:` lines repeat the `type` field of the data and are ignored.
    }
    if delivered {
        Err(AppError::Agent("the stream ended before the answer was complete".into()))
    } else {
        Ok(Attempt::Retry(
            AppError::Agent("empty response from the API".into()),
            Duration::from_secs(2),
        ))
    }
}

fn describe_http_error(status: u16, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let kind = parsed
        .as_ref()
        .and_then(|v| v["error"]["type"].as_str().map(str::to_string))
        .unwrap_or_else(|| "http_error".into());
    let message = parsed
        .as_ref()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    format!("HTTP {status} {kind}: {message}")
}

// ---------------------------------------------------------------------------
// Approved commands
// ---------------------------------------------------------------------------

const RUN_SCRIPT: &str = r#"cd -- "$1" 2>/dev/null || cd ~ || exit 97
eval "$2""#;

fn clip(text: String) -> (String, bool) {
    if text.len() <= MAX_TOOL_OUTPUT {
        return (text, false);
    }
    let mut head_end = MAX_TOOL_OUTPUT / 2;
    while !text.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let mut tail_start = text.len() - MAX_TOOL_OUTPUT / 2;
    while !text.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    let omitted = tail_start - head_end;
    (
        format!("{}\n\n[... {omitted} octets omis ...]\n\n{}", &text[..head_end], &text[tail_start..]),
        true,
    )
}

/// Runs a command the user approved, in a login shell of `distro`.
pub fn run_command(distro: &str, cwd: Option<&str>, command: &str) -> AppResult<CommandResult> {
    if command.trim().is_empty() {
        return Err(AppError::InvalidInput("the command is empty".into()));
    }
    if command.len() > MAX_COMMAND_LEN || command.contains('\0') {
        return Err(AppError::InvalidInput("the command is too long or contains a NUL byte".into()));
    }
    let cwd = cwd.filter(|c| c.starts_with('/') || c.starts_with('~')).unwrap_or("~");
    let cwd = if cwd == "~" { "." } else { cwd };
    let started = Instant::now();
    logging::info("agent", &format!("running approved command in {distro}: {}", command.chars().take(200).collect::<String>()));
    let out = wsl::exec_script(distro, "bash", RUN_SCRIPT, &[cwd, command], COMMAND_TIMEOUT)?;
    let (stdout, t1) = clip(wsl::decode_output(&out.stdout));
    let (stderr, t2) = clip(wsl::decode_output(&out.stderr));
    Ok(CommandResult {
        exit_code: out.code,
        stdout,
        stderr,
        timed_out: out.timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
        truncated: t1 || t2,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hint_never_reveals_the_key() {
        let key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
        let hint = key_hint(key);
        assert!(hint.starts_with("sk-ant-"));
        assert!(hint.ends_with("6789"));
        assert!(hint.len() < key.len());
    }

    #[test]
    fn key_shape() {
        assert!(valid_key_shape("sk-ant-api03-abcdefghijklmnopqrstuvwxyz"));
        assert!(!valid_key_shape("short"));
        assert!(!valid_key_shape("sk-ant-api03 with spaces in it......"));
    }

    #[test]
    fn body_has_fallback_except_haiku() {
        let b = build_body("claude-opus-5-5", "medium", json!("s"), json!([]), json!([]));
        assert_eq!(b["fallbacks"], "default");
        assert!(b.get("tools").is_none());
        assert_eq!(b["thinking"]["type"], "adaptive");
        let h = build_body("claude-haiku-5-5", "low", json!("s"), json!([{"name": "x"}]), json!([]));
        assert!(h.get("fallbacks").is_none());
        assert_eq!(h["tools"][0]["name"], "x");
        assert_eq!(h["output_config"]["effort"], "low");
    }

    #[test]
    fn clip_keeps_head_and_tail() {
        let long = "é".repeat(MAX_TOOL_OUTPUT);
        let (out, truncated) = clip(long);
        assert!(truncated);
        assert!(out.contains("octets omis"));
        let (short, t) = clip("ok".into());
        assert_eq!(short, "ok");
        assert!(!t);
    }

    #[test]
    fn configure_validates_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let state = AgentState::new(dir.path());
        let bad = state.configure(ConfigureRequest { api_key: None, model: "gpt".into(), effort: "medium".into() });
        assert!(bad.is_err());
        let st = state
            .configure(ConfigureRequest {
                api_key: Some("sk-ant-api03-abcdefghijklmnopqrstuvwxyz".into()),
                model: "claude-sonnet-5-5".into(),
                effort: "high".into(),
            })
            .unwrap();
        assert!(st.has_key);
        assert_eq!(st.key_source, "stored");
        assert_eq!(st.model, "claude-sonnet-5-5");
        let reloaded = AgentState::new(dir.path());
        assert_eq!(reloaded.status().effort, "high");
        let cleared = reloaded
            .configure(ConfigureRequest { api_key: Some(String::new()), model: "claude-opus-5-5".into(), effort: "medium".into() })
            .unwrap();
        assert_ne!(cleared.key_source, "stored");
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Hits the real endpoint with a fake key: proves TLS and error parsing work.
    /// Run with `cargo test --lib -- --ignored agent::live`.
    #[test]
    #[ignore]
    fn rejects_a_fake_key_with_a_clear_message() {
        let cancel = AtomicBool::new(false);
        let body = serde_json::to_string(&build_body(DEFAULT_MODEL, "low", json!("x"), json!([]), json!([{"role": "user", "content": "hi"}]))).unwrap();
        let err = send_with_retries("sk-ant-api03-not-a-real-key-000000000000", true, &body, &cancel, &|_| true).unwrap_err();
        let text = err.to_string();
        assert!(text.contains("HTTP 401"), "{text}");
    }
}
