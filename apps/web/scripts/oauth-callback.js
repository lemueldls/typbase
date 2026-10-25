(() => {
  try {
    if (location.pathname !== "/") return;

    let params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("state") || !(params.has("code") || params.has("error"))) {
      params = new URLSearchParams(location.search);
      if (!params.has("state") || !(params.has("code") || params.has("error"))) return;
    }

    window.__typbaseOauthCallback = params.toString();
  } catch {
    // A malformed URL leaves the app without a pending callback.
  }
})();
