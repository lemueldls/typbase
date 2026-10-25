/**
 * The OAuth response arrives in the URL fragment, but the app router runs
 * before Atproto boots and rewrites the location. An inline head script copies
 * the params to this global before the router can remove them.
 */
export function takeOAuthCallback(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  const raw = window.__typbaseOauthCallback;
  if (!raw) return null;
  delete window.__typbaseOauthCallback;
  const params = new URLSearchParams(raw);

  return params.has("state") && (params.has("code") || params.has("error")) ? params : null;
}
