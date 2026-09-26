/**
 * Tab and native window titles. The pages set them through Nuxt's head
 * composables; `formatDocumentTitle` keeps the parts consistent, and the Tauri
 * shell mirrors the result into the OS window (see `apps/native/src/lib.rs`).
 */

/** App name used when no page or workspace title is available. */
export const APP_NAME = "Typbase";

const SEPARATOR = " · ";

/**
 * Join title parts with a middle dot. Blank parts drop out, repeats collapse so
 * a page named after its workspace does not read "X · X", and an empty result
 * falls back to the app name.
 */
export function formatDocumentTitle(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;

    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(value);
  }

  return kept.join(SEPARATOR) || APP_NAME;
}
