import {
  NATIVE_OAUTH_METADATA_PATH,
  NATIVE_OAUTH_REDIRECT_URI,
  OAUTH_CLIENT_NAME,
  OAUTH_SCOPES,
} from "@typbase/typing";
import { defineEventHandler } from "nitro/h3";
import { useRuntimeConfig } from "nitro/runtime-config";

/**
 * Client metadata for the native shells (Tauri). Discoverable clients have to
 * live at an HTTPS URL, so this document is served by the deployed app; the
 * shell's client_id is `${appUrl}${NATIVE_OAUTH_METADATA_PATH}`. The redirect
 * is a private-use URI scheme: the OS opens Typbase with the response, which
 * `apps/web/src/lib/nativeAuth.ts` feeds into `initCallback`.
 *
 * Hand-written because airspace's `clientMetadata()` always emits a web client
 * with the redirect under the app origin; this one needs
 * `application_type: "native"` and the deep-link scheme.
 *
 * Prerendered alongside the web document; see that route for the build note.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const origin = config.public.appUrl.replace(/\/$/, "");

  return {
    client_id: `${origin}${NATIVE_OAUTH_METADATA_PATH}`,
    client_name: OAUTH_CLIENT_NAME,
    client_uri: origin,
    redirect_uris: [NATIVE_OAUTH_REDIRECT_URI],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    scope: OAUTH_SCOPES.join(" "),
    dpop_bound_access_tokens: true,
    application_type: "native",
    software_id: "at.typbase.app",
    software_version: "0.1.0",
  };
});
