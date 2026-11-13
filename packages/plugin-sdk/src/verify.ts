import type { PluginManifest } from "@typbase/typing";

import { parsePluginBundle, type PluginBundleFile } from "./bundle";
import { parseManifest } from "./manifest";

export interface PluginVerification {
  ok: boolean;
  manifest: PluginManifest | null;
  files: PluginBundleFile[];
  errors: string[];
  warnings: string[];
}

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1_000_000;

/** Validates a built `.tbplugin` artifact before publishing or installing. */
export function verifyPluginBundle(bytes: Uint8Array): PluginVerification {
  const errors: string[] = [];
  const warnings: string[] = [];
  let bundle: ReturnType<typeof parsePluginBundle> | null = null;

  try {
    bundle = parsePluginBundle(bytes);
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (!bundle) return { ok: false, manifest: null, files: [], errors, warnings };

  let manifest: PluginManifest | null = null;
  try {
    manifest = parseManifest(bundle.manifest);
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (bundle.files.length > MAX_FILES) {
    errors.push(`plugin bundle has ${bundle.files.length} files, over ${MAX_FILES}`);
  }

  const paths = new Set<string>();
  let bytesTotal = 0;
  for (const file of bundle.files) {
    if (paths.has(file.path)) errors.push(`duplicate plugin file "${file.path}"`);
    paths.add(file.path);
    const size = new TextEncoder().encode(file.text).byteLength;
    bytesTotal += size;
    if (size > MAX_FILE_BYTES) {
      warnings.push(`plugin file "${file.path}" is ${size} bytes`);
    }
  }

  if (manifest) {
    if (!paths.has(manifest.entry)) {
      errors.push(`plugin bundle is missing its entry file "${manifest.entry}"`);
    }
    if (bundle.files.length === 0) errors.push("plugin bundle has no files");
  }

  if (bytesTotal > 4_000_000)
    warnings.push(`plugin bundle is ${bytesTotal} bytes before compression`);

  return {
    ok: errors.length === 0,
    manifest,
    files: bundle.files,
    errors,
    warnings,
  };
}

export async function pluginBundleHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
