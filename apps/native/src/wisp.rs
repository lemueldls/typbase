//! Wisp domain XRPC over the native HTTP client.
//!
//! The webview calls this command instead of `fetch` on the Tauri origin.
//! Wisp's CORS policy does not include `tauri://localhost` (or Android's
//! `http://tauri.localhost`), so the browser request is rejected at preflight
//! even though the service accepts the bearer token.
//!
//! Only Wisp XRPC paths are reachable through this command. Site publishing
//! itself still goes through the PDS session, which the webview can call.

use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WispResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn wisp_request(
    url: String,
    method: String,
    headers: Option<BTreeMap<String, String>>,
    body: Option<String>,
) -> Result<WispResponse, String> {
    let url = reqwest::Url::parse(&url).map_err(|cause| format!("invalid Wisp URL: {cause}"))?;
    let local_http = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !local_http {
        return Err("Wisp requests must use https".into());
    }
    if !url.path().starts_with("/xrpc/place.wisp.v2.") {
        return Err("only place.wisp.v2 XRPC calls are allowed".into());
    }

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|cause| format!("invalid HTTP method: {cause}"))?;
    if method != reqwest::Method::GET && method != reqwest::Method::POST {
        return Err("Wisp requests support GET and POST only".into());
    }

    let client = crate::http::client()?;
    let mut request = client.request(method, url);
    for (name, value) in headers.unwrap_or_default() {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|cause| format!("Wisp request failed: {cause}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|cause| format!("could not read the Wisp response: {cause}"))?;

    Ok(WispResponse { status, body })
}
