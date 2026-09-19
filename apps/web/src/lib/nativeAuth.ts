import type { NativeAuth } from "@typbase/spaces";

import { isTauri } from "@typbase/storage";
import { NATIVE_OAUTH_REDIRECT_URI } from "@typbase/typing";

/**
 * OAuth for native shells. Desktop and mobile builds cannot act as an
 * `http://127.0.0.1` loopback client and have no HTTPS origin to receive a
 * redirect, so sign-in always runs in the system browser and the response
 * comes back through the `at.typbase.app` deep link registered in
 * `tauri.conf.json`. The matching client metadata is served from the deployed
 * origin at `NATIVE_OAUTH_METADATA_PATH`; Tauri dev loads the Nuxt dev server
 * but still uses that document, so desktop dev needs `NUXT_PUBLIC_APP_URL` set
 * to the deployed HTTPS origin.
 *
 * The shell registers the scheme at startup on Linux and Windows debug builds
 * (`register_all` in `apps/native/src/lib.rs`); macOS only registers bundled
 * apps, so use `pnpm tauri build --debug` there.
 */

const CALLBACK_TIMEOUT_MS = 5 * 60_000;

export function createNativeAuth(): NativeAuth | null {
  if (!isTauri()) return null;

  return {
    redirectUri: NATIVE_OAUTH_REDIRECT_URI,

    async open(url) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    },

    async waitForCallback() {
      const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

      return await new Promise<URLSearchParams>((resolve, reject) => {
        let unlisten: (() => void) | undefined;
        const timer = setTimeout(() => {
          unlisten?.();
          reject(new Error("Sign-in timed out. Try again."));
        }, CALLBACK_TIMEOUT_MS);

        void onOpenUrl((urls) => {
          const params = paramsOf(urls);
          if (!params) return;
          clearTimeout(timer);
          unlisten?.();
          resolve(params);
        }).then(
          (off) => {
            unlisten = off;
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },

    async takeLaunchCallback() {
      const { getCurrent } = await import("@tauri-apps/plugin-deep-link");
      const urls = await getCurrent().catch(() => null);

      return paramsOf(urls ?? []);
    },
  };
}

/** OAuth response params from any of the delivered URLs, query or fragment. */
function paramsOf(urls: readonly string[]): URLSearchParams | null {
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      const query = new URLSearchParams(url.search);
      if (hasResponse(query)) return query;

      const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
      if (hasResponse(fragment)) return fragment;
    } catch {
      // Not a URL; ignore it.
    }
  }

  return null;
}

function hasResponse(params: URLSearchParams): boolean {
  return params.has("state") && (params.has("code") || params.has("error"));
}
