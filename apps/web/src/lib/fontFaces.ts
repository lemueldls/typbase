import type { WorkspaceStore } from "@typbase/storage";

import { fontFacesOf } from "./customFonts";

/**
 * Faces registered with the browser's FontFace set. The Typst engine reads
 * font bytes itself, but CSS needs a registered face or the browser falls back
 * to a system family of the same name.
 */
const registered = new Map<string, FontFace[]>();

let customSignature = "";
let syncToken = 0;

function canRegister(): boolean {
  return typeof document !== "undefined" && typeof FontFace !== "undefined";
}

/**
 * Registers every face in one font file under the family the workspace stores.
 * Replacing a source removes the faces it registered before.
 */
export async function registerFontFaceSource(
  source: string,
  family: string,
  bytes: Uint8Array,
): Promise<number> {
  if (!canRegister()) return 0;

  unregisterFontFaceSource(source);

  const faces: FontFace[] = [];
  for (const info of fontFacesOf(bytes)) {
    const face = new FontFace(family, bytes as BufferSource, {
      weight: String(info.weight),
      style: info.style,
    });

    try {
      // A face that cannot load is worse than a fallback. Keep the rest.
      // oxlint-disable-next-line no-await-in-loop
      await face.load();
    } catch {
      continue;
    }

    document.fonts.add(face);
    faces.push(face);
  }

  if (faces.length) registered.set(source, faces);

  return faces.length;
}

/** Removes the faces one source registered. */
export function unregisterFontFaceSource(source: string): void {
  if (!canRegister()) return;

  const faces = registered.get(source);
  if (!faces) return;

  for (const face of faces) document.fonts.delete(face);
  registered.delete(source);
}

/**
 * Brings the browser's font set in line with a workspace's uploaded families.
 * A custom font is stored as blobs, so the CSS family is only available after
 * its bytes are registered here.
 */
export async function syncCustomFontFaces(store: WorkspaceStore): Promise<void> {
  if (!canRegister()) return;

  const fonts = store.getSettings().customFonts;
  const signature = JSON.stringify(fonts.map((font) => [font.family, [...font.hashes]]));
  if (signature === customSignature) return;

  const token = ++syncToken;
  const wanted = new Set<string>();
  let complete = true;

  for (const font of fonts) {
    for (const hash of font.hashes) {
      const source = `custom:${font.family}:${hash}`;
      wanted.add(source);
      if (registered.has(source)) continue;

      // oxlint-disable-next-line no-await-in-loop
      const bytes = await store.getBlob(hash);
      if (token !== syncToken) return;
      if (!bytes) {
        complete = false;
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop
      const count = await registerFontFaceSource(source, font.family, bytes);
      if (token !== syncToken) return;
      if (count === 0) complete = false;
    }
  }

  if (token !== syncToken) return;

  for (const source of [...registered.keys()]) {
    if (source.startsWith("custom:") && !wanted.has(source)) unregisterFontFaceSource(source);
  }

  // A failed engine or a blob that has not arrived yet must be retried on the
  // next style apply. Only remember a signature that produced every face.
  if (complete) customSignature = signature;
}
