import { OAUTH_SCOPES } from "@typbase/typing";
import { defineEventHandler } from "nitro/h3";
import { useRuntimeConfig } from "nitro/runtime-config";

/**
 * OAuth client metadata document, served at the URL used as `client_id`.
 * Public client: PAR + PKCE, no client secret, DPoP-bound access tokens.
 * The PDS fetches this once per authorization; keep it static.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const appUrl = config.public.appUrl;
  const origin = appUrl.replace(/\/$/, "");

  return {
    client_id: `${origin}/client-metadata`,
    client_name: "typbase",
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/callback`],
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
