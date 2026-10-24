//! One HTTP client for the app commands.
//!
//! reqwest's rustls backend ships without a crypto provider. Tauri and the
//! updater install `ring` on first use, but a command may run before either.
//! Install it here so the first Wisp or update request does not panic.
//!
//! Android's rustls platform verifier needs a JNI context that only the
//! hosting runtime sets up, and panics without one. Mozilla's compiled-in
//! roots work on every target, which also covers desktop.

use std::time::Duration;

use rustls::RootCertStore;

pub const USER_AGENT: &str = concat!("Typbase/", env!("CARGO_PKG_VERSION"));

pub fn client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let mut roots = RootCertStore::empty();
    roots.add_parsable_certificates(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().cloned());
    let tls = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .tls_backend_preconfigured(tls)
        .build()
        .map_err(|cause| format!("could not build the HTTP client: {cause}"))
}
