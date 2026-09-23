import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { ThemePaletteTokens } from "@typbase/typing";

import { stripCellMarkers } from "@typbase/codemirror";
import { isTauri, saveExportFile, sniffMime } from "@typbase/storage";

import { THEME_COLOR_KEYS, paletteSlots } from "~/lib/palette";
import { publishPrelude, publishSyntaxTheme, publishThemePalette } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore, type RenderOutcome } from "~/lib/renderWorker";
import { createZip } from "~/lib/zip";

export interface ExportOptions {
  html: boolean;
  pdf: boolean;
  svg: boolean;
  /** SVG only: one merged file instead of one per page. */
  svgMerged: boolean;
  /** Write the compilable Typst project: source, lib, data, fonts. */
  project: boolean;
  /** Strip `// %%` cell markers from project sources. */
  stripMarkers?: boolean;
  fonts: boolean;
  /** "light" (default) normalizes colors for reading/printing. */
  theme: "light" | "workspace";
  pageSize: "a4" | "letter";
}

export interface ExportFile {
  /** Bundle-relative path; forward slashes. */
  name: string;
  bytes: Uint8Array;
}

export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** File stem from the page title, falling back to its path. */
export function fileBase(title: string, path: string): string {
  const fromPath =
    path
      .split("/")
      .pop()
      ?.replace(/\.typ$/i, "") ?? "";

  return slug(title) || slug(fromPath) || "page";
}

export async function buildExport(
  store: WorkspaceStore,
  pageId: string,
  options: ExportOptions,
  typstState?: TypstState,
): Promise<{ base: string; files: ExportFile[] }> {
  const page = store.getPage(pageId);
  if (!page) throw new Error(`No page named ${pageId}`);

  const source = await store.loadPageText(pageId);
  const base = fileBase(page.title, page.path);
  const themeOptions = { theme: options.theme, pageSize: options.pageSize } as const;
  const htmlPrelude = await publishPrelude(store.getSettings(), { ...themeOptions, paged: false });
  const pagedPrelude = await publishPrelude(store.getSettings(), { ...themeOptions, paged: true });
  const palette = publishThemePalette(store.getSettings(), themeOptions);
  const encoder = new TextEncoder();
  const files: ExportFile[] = [];
  const names = new Set<string>();
  const payloads = new Map<string, ExportFile>();
  const artifacts: { html?: string; pdf?: string; svg: string[] } = { svg: [] };

  const addFile = (file: ExportFile): void => {
    if (names.has(file.name)) {
      throw new Error(`Two exported files would both be named ${file.name}; rename one page.`);
    }

    names.add(file.name);
    files.push(file);
  };

  const collect = (outcome: RenderOutcome): void => {
    for (const payload of outcome.payloads) {
      // Packages were installed into the worker's world; the exported project
      // references them by spec instead of vendoring the tarball.
      if (payload.type === "package") continue;

      const bytes = payload.type === "file" ? payload.bytes : encoder.encode(payload.text);
      payloads.set(payload.path, { name: payload.path, bytes });
    }
  };

  setPublishRequestStore(store);

  if (options.html) {
    const rendered = await renderInWorker({
      pagePath: page.path,
      source,
      prelude: htmlPrelude,
      wants: "html",
      spaceId: store.workspaceId,
      theme: palette,
    });
    if (!rendered.html) {
      throw new Error("The render produced no HTML; check the page diagnostics.");
    }

    collect(rendered);
    artifacts.html = `${base}.html`;
    addFile({
      name: artifacts.html,
      bytes: encoder.encode(styleExportHtml(await inlineBlobs(rendered.html, store), palette)),
    });
  }

  if (options.pdf) {
    const rendered = await renderInWorker({
      pagePath: page.path,
      source,
      prelude: pagedPrelude,
      wants: "pdf",
      spaceId: store.workspaceId,
      theme: palette,
    });
    if (!rendered.pdf) {
      throw new Error("The render produced no PDF; check the page diagnostics.");
    }

    collect(rendered);
    artifacts.pdf = `${base}.pdf`;
    addFile({ name: artifacts.pdf, bytes: rendered.pdf });
  }

  if (options.svg) {
    const rendered = await renderInWorker({
      pagePath: page.path,
      source,
      prelude: pagedPrelude,
      wants: "svg",
      merged: options.svgMerged,
      spaceId: store.workspaceId,
      theme: palette,
    });
    if (!rendered.svg?.length) {
      throw new Error("The render produced no SVG pages; check the page diagnostics.");
    }

    collect(rendered);
    const many = rendered.svg.length > 1;
    rendered.svg.forEach((svg, index) => {
      const name = `${base}${many ? `-${index + 1}` : ""}.svg`;
      artifacts.svg.push(name);
      addFile({ name, bytes: encoder.encode(svg) });
    });
  }

  if (options.project) {
    const projectSource = options.stripMarkers ? stripCellMarkers(source) : source;
    addFile({ name: `${base}.typ`, bytes: encoder.encode(`${pagedPrelude}\n${projectSource}`) });
    if (typstState) {
      addFile({ name: "typbase/lib.typ", bytes: encoder.encode(typstState.typbaseLib()) });
    }
    const syntax = await publishSyntaxTheme(store.getSettings(), themeOptions);
    addFile({ name: syntax.path, bytes: encoder.encode(syntax.text) });
    for (const payload of payloads.values()) addFile(payload);
    if (options.fonts) {
      for (const font of await fontFiles()) addFile(font);
    }
  }

  // One artifact stays a single file; more than one becomes a zip with an
  // index that works without a local server.
  if (files.length > 1) {
    const readme = buildReadme(page.title, base, options);
    addFile({ name: "README.md", bytes: encoder.encode(readme) });
    if (artifacts.html || artifacts.svg.length) {
      addFile({ name: "index.html", bytes: encoder.encode(buildIndex(page.title, artifacts)) });
    }
  }

  return { base, files };
}

/** Saves either the single file or a zip of the bundle. */
export async function saveExport(base: string, files: ExportFile[]): Promise<void> {
  if (files.length === 1) {
    const [file] = files;
    if (file) await saveOne(file.name, file.bytes);

    return;
  }

  await saveOne(
    `${base}.zip`,
    createZip(files.map((file) => ({ name: file.name, bytes: file.bytes }))),
  );
}

async function saveOne(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) {
    // The native dialog is the only save path that works in the webview;
    // anchor downloads there are treated as file: navigations and blocked.
    await saveExportFile(name, bytes);

    return;
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // The download has started; release the URL once it has had time to read.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const BLOB_REFERENCE = /\/?typbase\/blob\/([0-9a-f]{64})(?:\.[a-z0-9]+)?/gi;

/** Replaces blob references in rendered HTML with data URIs, so the document
 *  is self-contained wherever it is opened. */
export async function inlineBlobs(html: string, store: WorkspaceStore): Promise<string> {
  const hashes = new Set<string>();
  for (const match of html.matchAll(BLOB_REFERENCE)) {
    hashes.add(match[1]!.toLowerCase());
  }
  if (!hashes.size) return html;

  const uris = new Map<string, string>();
  for (const hash of hashes) {
    const bytes = await store.getBlob(hash);
    if (!bytes) continue;

    const mime = sniffMime(bytes);
    uris.set(hash, `data:${mime};base64,${base64(bytes)}`);
  }

  return html.replace(BLOB_REFERENCE, (reference, hash: string) => {
    return uris.get(hash.toLowerCase()) ?? reference;
  });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

/** Bundled fonts, so the project renders the same without system fonts. */
export async function fontFiles(): Promise<ExportFile[]> {
  const { getTypstFontImports } = await import("~/composables/typst");
  const files: ExportFile[] = [];

  for (const fontImports of getTypstFontImports()) {
    const urls = await Promise.all(
      fontImports.map(async (fontImport) => (await fontImport).default),
    );
    for (const url of urls) {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const name = decodeURIComponent(url.split("?")[0]!.split("/").pop() ?? "font");
      files.push({ name: `typbase/fonts/${name}`, bytes });
    }
  }

  return files;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paletteColor(palette: ThemePaletteTokens, key: (typeof THEME_COLOR_KEYS)[number]): string {
  const slots = paletteSlots(palette);
  const slot = slots[THEME_COLOR_KEYS.indexOf(key)] ?? [127, 127, 127];

  return `rgb(${slot.join(",")})`;
}

/**
 * Typst's HTML export has no page to carry the fill, so the chosen palette's
 * surface and text colors are applied to the document root. Without this a
 * dark palette renders light text on the browser's white background.
 */
export function styleExportHtml(html: string, palette: ThemePaletteTokens): string {
  const style = `<style>html{background:${paletteColor(palette, "surface")};color:${paletteColor(palette, "text")}}</style>`;

  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : `${style}${html}`;
}

function buildIndex(
  title: string,
  artifacts: { html?: string; pdf?: string; svg: string[] },
): string {
  const links = [
    artifacts.html ? `<li><a href="${artifacts.html}">HTML document</a></li>` : "",
    artifacts.pdf ? `<li><a href="${artifacts.pdf}">PDF document</a></li>` : "",
  ]
    .filter(Boolean)
    .join("\n      ");
  const sheets = artifacts.svg.map((name) => `      <img src="${name}" alt="Page">`).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; padding: 2rem; font-family: system-ui, sans-serif; background: #f3f4f6; color: #1f2328; }
      ul { margin: 0 0 2rem; padding-left: 1.2rem; }
      img { display: block; max-width: 100%; margin: 0 auto 1.5rem; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <ul>
      ${links}
    </ul>
${sheets}
  </body>
</html>
`;
}

function buildReadme(title: string, base: string, options: ExportOptions): string {
  const lines = [
    `# ${title}`,
    "",
    `Typbase export (${new Date().toISOString()}).`,
    "",
    "## Files",
    "",
  ];

  lines.push(`- \`${base}.html\`, \`${base}.pdf\`, \`${base}*.svg\`: rendered artifacts`);
  if (options.project) {
    lines.push(
      `- \`${base}.typ\`: the note source with the workspace prelude inlined`,
      "- `typbase/`: the library, referenced data and blobs, and optionally fonts",
    );
  }
  lines.push("");

  if (options.project) {
    lines.push(
      "## Compiling the Typst source",
      "",
      "The project imports `/typbase/lib.typ`, so compile it from the extracted bundle root:",
      "",
      "```sh",
      `typst compile --root .${options.fonts ? " --font-path typbase/fonts" : ""} ${base}.typ`,
      "```",
      "",
      "The prelude (theme, fonts, text size, heading styles) is inlined at the top of the file.",
      "",
      'Tinymist needs the same root (`"tinymist.typstExtraArgs": ["--root", "."]`), because',
      "the prelude's import is root-absolute.",
      "",
    );
  }

  return lines.join("\n");
}
