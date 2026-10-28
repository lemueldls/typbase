import { defineHandler } from "nitro";

import { registryCatalog } from "../lib/catalog";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default defineHandler(async () => {
  const catalog = await registryCatalog();
  const cards = catalog.entries
    .map((entry) => {
      const capabilities = entry.capabilities.length
        ? entry.capabilities.map(escapeHtml).join(", ")
        : "none";
      const version = entry.version ? `v${escapeHtml(entry.version)}` : "no release";
      return `<article>
        <h2>${escapeHtml(entry.listing.name)} <small>${version}</small></h2>
        ${entry.listing.description ? `<p>${escapeHtml(entry.listing.description)}</p>` : ""}
        <p><strong>Capabilities:</strong> ${capabilities}</p>
        <p><strong>Publisher:</strong> <code>${escapeHtml(entry.publisher)}</code></p>
        <p><strong>Install URI:</strong> <code>${escapeHtml(entry.uri)}</code></p>
      </article>`;
    })
    .join("");

  const warnings = catalog.warnings.length
    ? `<section><h2>Warnings</h2><ul>${catalog.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join("")}</ul></section>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Typbase plugin registry</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
    body { max-width: 60rem; margin: 0 auto; padding: 2rem; }
    article { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
    h1, h2 { line-height: 1.2; }
    small, code { color: color-mix(in srgb, currentColor 65%, transparent); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Typbase plugin registry</h1>
  <p>Publishers own their records and release blobs. This catalog indexes ${catalog.publishers.length} publisher(s). Install a plugin by pasting its listing URI into Typbase.</p>
  ${cards || "<p>No plugins are indexed yet. Set <code>REGISTRY_PUBLISHERS</code> to comma-separated DIDs.</p>"}
  ${warnings}
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
});
