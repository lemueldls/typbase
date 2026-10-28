#!/usr/bin/env node
/**
 * Uploads one demo asset to GitHub's user-attachments store and optionally
 * rewrites the hero link in README.md.
 *
 * GitHub has no documented public endpoint for this. The endpoint below is the
 * one its web UI and newer gh clients use, and it requires a user token with
 * repository access. A GitHub Actions GITHUB_TOKEN does not work.
 *
 * Usage:
 *   node scripts/demo/attachment.mjs docs/video/hero.mp4 --update-readme
 */
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const README = "README.md";
const MIME = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function token() {
  const configured = process.env.GITHUB_ATTACHMENT_TOKEN || process.env.GH_TOKEN;
  if (configured) return configured;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "Set GITHUB_ATTACHMENT_TOKEN or run `gh auth login` before uploading an attachment.",
    );
  }
}

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
    const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through to the project default.
  }

  return "lemueldls/typbase";
}

async function api(path, init, authorization) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${authorization}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "typbase-demo-attachment",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass a file path, for example docs/video/hero.mp4.");

  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported attachment type: ${file}`);
  const info = await stat(file);
  if (mime.startsWith("image/") && info.size > 10 * 1024 * 1024) {
    throw new Error("GitHub attachment images must be 10 MB or smaller.");
  }

  const authorization = token();
  const [owner, name] = repository().split("/");
  const repo = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    undefined,
    authorization,
  );
  const query = new URLSearchParams({
    name: basename(file),
    content_type: mime,
    repository_id: String(repo.id),
  });
  const bytes = await readFile(file);
  const response = await fetch(
    `https://uploads.github.com/user-attachments/assets?${query.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authorization}`,
        Accept: "application/json",
        "Content-Type": mime,
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    throw new Error(`Attachment upload failed (${response.status}): ${await response.text()}`);
  }
  const result = await response.json();
  if (!result.url) throw new Error("GitHub returned no attachment URL.");
  console.log(result.url);

  if (process.argv.includes("--update-readme")) {
    const readme = await readFile(README, "utf8");
    const next = readme.replace(
      /(\[!\[[^\]]*\]\([^)]*\)\]\()https:\/\/github\.com\/user-attachments\/assets\/[^)]+(\))/,
      `$1${result.url}$2`,
    );
    if (next === readme) throw new Error("Could not find the hero attachment link in README.md.");
    await writeFile(README, next);
    console.log(`updated ${README}`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
