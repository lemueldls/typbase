import type { PluginManifest } from "@typbase/typing";

import {
  createPluginBundle,
  parseManifest,
  pluginBundleHash,
  pluginSlug,
  verifyPluginBundle,
  type PluginBundleFile,
} from "@typbase/plugin-sdk";
import { publishPlugin } from "@typbase/spaces/plugin-registry";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { publishSession, type AuthOptions } from "./auth";

const SKIP_DIRS = new Set(["dist", "node_modules", ".git", ".nuxt", ".output"]);

async function collectFiles(root: string, relative = ""): Promise<PluginBundleFile[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: PluginBundleFile[] = [];

  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectFiles(root, next)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === "plugin.json") continue;
    if (!entry.name.endsWith(".typ") && !entry.name.endsWith(".css")) continue;
    files.push({ path: next, text: await readFile(path.join(root, next), "utf8") });
  }

  return files;
}

export interface PluginBuild {
  manifest: PluginManifest;
  files: PluginBundleFile[];
  artifact: Uint8Array;
  hash: string;
  slug: string;
}

export async function buildPluginFolder(root: string): Promise<PluginBuild> {
  const manifestText = await readFile(path.join(root, "plugin.json"), "utf8");
  const manifest = parseManifest(JSON.parse(manifestText) as unknown);
  const files = await collectFiles(root);
  if (!files.some((file) => file.path === manifest.entry)) {
    throw new Error(`plugin source is missing its entry file "${manifest.entry}"`);
  }
  const artifact = createPluginBundle(manifest, files);
  const verification = verifyPluginBundle(artifact);
  if (!verification.ok) {
    throw new Error(verification.errors.join("; "));
  }

  return {
    manifest,
    files,
    artifact,
    hash: await pluginBundleHash(artifact),
    slug: pluginSlug(manifest.id),
  };
}

export async function verifyPluginPath(target: string): Promise<{
  ok: boolean;
  target: string;
  manifest: PluginManifest | null;
  hash: string | null;
  size: number;
  errors: string[];
  warnings: string[];
}> {
  let artifact: Uint8Array;
  let targetPath = target;

  try {
    const stat = await import("node:fs/promises").then((fs) => fs.stat(target));
    if (stat.isDirectory()) {
      const build = await buildPluginFolder(target);
      artifact = build.artifact;
      targetPath = path.join(target, "plugin.json");
    } else {
      artifact = new Uint8Array(await readFile(target));
    }
  } catch (cause) {
    return {
      ok: false,
      target,
      manifest: null,
      hash: null,
      size: 0,
      errors: [cause instanceof Error ? cause.message : String(cause)],
      warnings: [],
    };
  }

  const verification = verifyPluginBundle(artifact);

  return {
    ok: verification.ok,
    target: targetPath,
    manifest: verification.manifest,
    hash: verification.ok ? await pluginBundleHash(artifact) : null,
    size: artifact.byteLength,
    errors: verification.errors,
    warnings: verification.warnings,
  };
}

export async function writePluginBundle(root: string, outDir: string): Promise<string> {
  const build = await buildPluginFolder(root);
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${build.slug}.tbplugin`);
  await writeFile(out, build.artifact);

  return out;
}

export interface PublishPluginOptions extends AuthOptions {
  slug?: string;
}

export async function publishPluginFolder(
  root: string,
  options: PublishPluginOptions,
): Promise<{ listingUri: string; releaseUri: string; version: string; sha256: string }> {
  const build = await buildPluginFolder(root);
  const { session, did } = await publishSession(options);
  const slug = options.slug ?? build.slug;
  const listingUri = `at://${did}/at.typbase.plugin/${slug}`;
  const manifest: PluginManifest = { ...build.manifest, id: listingUri };
  const artifact = createPluginBundle(manifest, build.files);
  const verification = verifyPluginBundle(artifact);
  if (!verification.ok) throw new Error(verification.errors.join("; "));

  const published = await publishPlugin(session, did, {
    slug,
    manifest,
    artifact,
  });

  return { ...published, sha256: await pluginBundleHash(artifact) };
}
