use std::collections::HashMap;
use std::time::Duration;

use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CREDENTIAL_SERVICE: &str = "com.starmad.orbitcopilot";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<Value>,
    #[serde(default)]
    allow_invalid_certs: bool,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
struct NativeResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: Value,
}

fn default_timeout() -> u64 {
    30
}

#[tauri::command]
async fn native_request(request: NativeRequest) -> Result<NativeResponse, String> {
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("无效 HTTP 方法: {error}"))?;
    let client = Client::builder()
        .danger_accept_invalid_certs(request.allow_invalid_certs)
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(1, 180)))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("无法初始化网络客户端: {error}"))?;
    let mut outbound = client.request(method, &request.url);
    for (name, value) in request.headers {
        outbound = outbound.header(&name, &value);
    }
    if let Some(body) = request.body {
        outbound = outbound.json(&body);
    }
    let response = outbound
        .send()
        .await
        .map_err(|error| format!("连接失败: {error}"))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败: {error}"))?;
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()));
    Ok(NativeResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
fn save_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| format!("无法打开系统凭据库: {error}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry
        .set_password(&value)
        .map_err(|error| format!("无法保存系统凭据: {error}"))
}

#[tauri::command]
fn load_secret(key: String) -> Result<String, String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| format!("无法打开系统凭据库: {error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(format!("无法读取系统凭据: {error}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            native_request,
            save_secret,
            load_secret
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Orbit Copilot");
}
