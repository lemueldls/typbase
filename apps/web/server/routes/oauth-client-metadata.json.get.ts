import {
  OAUTH_CLIENT_NAME,
  OAUTH_METADATA_PATH,
  OAUTH_REDIRECT_PATH,
  OAUTH_SCOPES,
} from "@typbase/typing";
import { clientMetadata } from "airspace/oauth/metadata";
import { defineEventHandler } from "nitro/h3";
import { useRuntimeConfig } from "nitro/runtime-config";

/**
 * OAuth client metadata document, served at the URL used as `client_id`.
 * Built with the same helper the browser client uses, from the same
 * constants, so the document the PDS fetches matches the one the client
 * declared. Public client: PAR + PKCE, no client secret, DPoP-bound access
 * tokens, refresh tokens.
 *
 * The redirect target is the app root, not a dedicated route: the browser
 * client only processes a callback when `findRedirectUrl()` matches the
 * current location against a registered URI, and a server-side bounce would
 * drop the params before that check. The root matches for this discoverable
 * client and for the loopback client ids used in local dev.
 *
 * Prerendered (see `nitro.prerender.routes`), so a static deploy serves it
 * without a worker. The origin is baked at build time; set
 * `NUXT_PUBLIC_APP_URL` when building.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const origin = config.public.appUrl.replace(/\/$/, "");

  return clientMetadata({
    baseUrl: origin,
    redirectPath: OAUTH_REDIRECT_PATH,
    name: OAUTH_CLIENT_NAME,
    scopes: OAUTH_SCOPES,
    metadataPath: OAUTH_METADATA_PATH,
  });
});
