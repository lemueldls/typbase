import { OAUTH_SCOPES } from "@typbase/typing";
import { defineEventHandler } from "nitro/h3";
import { useRuntimeConfig } from "nitro/runtime-config";

/**
 * OAuth client metadata document, served at the URL used as `client_id`.
 * Public client: PAR + PKCE, no client secret, DPoP-bound access tokens.
 * The PDS fetches this once per authorization; keep it static.
 *
 * The redirect target is the app root, not a dedicated route: the browser
 * client only processes a callback when `findRedirectUrl()` matches the
 * current location against a registered URI, and a server-side bounce would
 * drop the params before that check. The root matches for both this discoverable
 * client and the loopback client ids used in local dev.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const appUrl = config.public.appUrl;
  const origin = appUrl.replace(/\/$/, "");

  return {
    client_id: `${origin}/client-metadata`,
    client_name: "typbase",
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    response_types: ["code"],
    grant_types: ["authorization_code"],
    token_endpoint_auth_method: "none",
    scope: OAUTH_SCOPES.join(" "),
    dpop_bound_access_tokens: true,
    application_type: "web",
    software_id: "at.typbase.app",
    software_version: "0.1.0",
  };
});
