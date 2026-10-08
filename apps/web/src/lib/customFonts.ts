import type { WorkspaceStore } from "@typbase/storage";
import type { CustomFont } from "@typbase/typing";

import { TypstState } from "@typbase/engine";

export interface FontPayload {
  family: string;
  bytes: Uint8Array;
}

/**
 * The family a font file declares, or null when the bytes are not a font the
 * engine can read. The engine answers this rather than the app parsing the
 * `name` table, so the name is one Typst will resolve later.
 */
export function fontFamilyOf(bytes: Uint8Array): string | null {
  try {
    return TypstState.fontFamilies(bytes)[0] ?? null;
  } catch {
    return null;
  }
}

/** Adds one uploaded file to a family, merging with what is already declared. */
export function mergeCustomFont(
  fonts: readonly CustomFont[],
  family: string,
  hash: string,
): CustomFont[] {
  const next = fonts.map((font) => ({ ...font, hashes: [...font.hashes] }));
  const existing = next.find((font) => font.family === family);

  if (!existing) return [...next, { family, hashes: [hash] }];
  if (!existing.hashes.includes(hash)) existing.hashes.push(hash);

  return next;
}

/** Drops a family and every face it declared. */
export function removeCustomFont(fonts: readonly CustomFont[], family: string): CustomFont[] {
  return fonts.filter((font) => font.family !== family);
}

/** The bytes of every uploaded face this device actually holds. */
export async function customFontPayloads(store: WorkspaceStore): Promise<FontPayload[]> {
  const payloads: FontPayload[] = [];

  for (const font of store.getSettings().customFonts) {
    for (const hash of font.hashes) {
      const bytes = await store.getBlob(hash);
      if (bytes) payloads.push({ family: font.family, bytes });
    }
  }

  return payloads;
}

/**
 * Hashes already handed to a given wasm instance. Panic recovery builds a fresh
 * state, and the fonts have to load into it again.
 */
const installed = new WeakMap<TypstState, Set<string>>();

/** Installs every uploaded face this device holds into one wasm instance. */
export async function installCustomFonts(
  typstState: TypstState,
  store: WorkspaceStore,
): Promise<void> {
  let seen = installed.get(typstState);
  if (!seen) {
    seen = new Set();
    installed.set(typstState, seen);
  }

  for (const font of store.getSettings().customFonts) {
    for (const hash of font.hashes) {
      if (seen.has(hash)) continue;
      const bytes = await store.getBlob(hash);
      if (!bytes) continue;
      typstState.installFont(bytes);
      seen.add(hash);
    }
  }
}

/** Families whose bytes are declared but absent on this device. */
export async function missingFontFamilies(store: WorkspaceStore): Promise<string[]> {
  const missing: string[] = [];

  for (const font of store.getSettings().customFonts) {
    for (const hash of font.hashes) {
      if (!(await store.getBlob(hash))) {
        missing.push(font.family);
        break;
      }
    }
  }

  return missing;
}
