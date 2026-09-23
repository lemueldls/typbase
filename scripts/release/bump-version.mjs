#!/usr/bin/env node

// Bumps every version source in the repo to the same value:
//   Cargo.toml, Cargo.lock, apps/native/tauri.conf.json,
//   packages/*/package.json, and the nix derivations.
//
// Android versionName/versionCode are not here: `tauri android build` writes
// gen/android/app/tauri.properties from tauri.conf.json on every build (the
// file is generated and gitignored).
//
// Usage: node scripts/release/bump-version.mjs <patch|minor|major|x.y.z> [--dry-run]
// Prints the new version to stdout.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const [, , bump, ...flags] = process.argv;
const dryRun = flags.includes("--dry-run");

if (!bump) {
  console.error(
    "Usage: node scripts/release/bump-version.mjs <patch|minor|major|x.y.z> [--dry-run]",
  );
  process.exit(1);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function write(path, text) {
  if (!dryRun) writeFileSync(join(root, path), text);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error(`not a semantic version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+/.test(kind)) return kind;

  const [major, minor, patch] = parseVersion(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;

  throw new Error(`unknown bump: ${kind}`);
}

const tauriPath = "apps/native/tauri.conf.json";
const tauri = JSON.parse(read(tauriPath));
const version = nextVersion(tauri.version, bump);

// Cargo.toml
{
  const path = "Cargo.toml";
  const text = read(path).replace(/^package\.version = ".*"$/m, `package.version = "${version}"`);
  write(path, text);
}

// Cargo.lock
{
  const path = "Cargo.lock";
  let text = read(path);
  for (const name of ["typbase", "wasm"]) {
    const pattern = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`);
    text = text.replace(pattern, `$1${version}$2`);
  }
  write(path, text);
}

// apps/native/tauri.conf.json
// Patch the version line instead of re-serializing: JSON.stringify expands
// arrays that oxfmt collapses, which fails fmt:check after every bump.
{
  const text = read(tauriPath).replace(/^  "version": "[^"]+"/m, `  "version": "${version}"`);
  write(tauriPath, text);
}

// packages/*/package.json
{
  const dir = join(root, "packages");
  for (const name of readdirSync(dir)) {
    const path = `packages/${name}/package.json`;
    let pkg;
    try {
      pkg = JSON.parse(read(path));
    } catch {
      continue;
    }
    if (pkg.private) continue;

    pkg.version = version;
    write(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

// nix derivations
for (const path of ["nix/typbase.nix", "nix/typbase-bin.nix", "nix/nixpkgs/typbase.nix"]) {
  const text = read(path).replace(/^(\s*version = ")[^"]+(";)$/m, `$1${version}$2`);
  write(path, text);
}

console.log(version);
