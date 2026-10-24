import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta, SitePageSettings, SiteSettings, ThemePaletteTokens } from "@typbase/typing";

import { fontFiles } from "~/lib/exportPage";
import { pageContext, typstContextBinding } from "~/lib/pageContext";
import { publishPrelude, publishThemePalette } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore } from "~/lib/renderWorker";

import { isSiteEmbedAllowed } from "./embeds";
import { siteRkey, siteSlug } from "./slug";

export { siteRkey, siteSlug } from "./slug";

import {
  escapeHtml,
  feed,
  htmlToText,
  renderHomeIndex,
  renderNotFound,
  renderShell,
  robots,
  siteScript,
  siteStyles,
  sitemap,
} from "./shell";

/** One page that made it into the build. */
export interface SiteBuildPage {
  id: string;
  title: string;
  description: string;
  tags: string[];
  sourcePath: string;
  /** Public path, always ending in a slash. The home page is `/`. */
  url: string;
  /** Bundle path of the rendered page. */
  file: string;
  visibility: "public" | "unlisted";
  updatedAt: number;
  createdAt: number;
  includeInSearch: boolean;
  includeInFeed: boolean;
  source: string;
  html: string;
  text: string;
}

export interface SiteBuildFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface SiteStandardDocument {
  pageId: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  textContent: string;
  publishedAt: string;
  updatedAt: string;
}

export interface SiteBuild {
  name: string;
  slug: string;
  baseUrl: string;
  files: SiteBuildFile[];
  pages: SiteBuildPage[];
  /** Only public pages, already ordered for navigation. */
  navigation: SiteBuildNavigationGroup[];
  warnings: string[];
  totalBytes: number;
  hash: string;
  standard: {
    publication: {
      url: string;
      name: string;
      description: string;
      palette: ThemePaletteTokens;
    };
    documents: SiteStandardDocument[];
  };
}

export interface SiteNavigationPage {
  id: string;
  title: string;
  url: string;
  updatedAt: number;
}

export interface SiteBuildNavigationGroup {
  id: string | null;
  name: string;
  pages: SiteNavigationPage[];
}

export interface SiteBuildOptions {
  /** Canonical origin and optional base path, without a trailing slash. */
  baseUrl?: string;
  /** Signed-in DID, used for the default shared Wisp URL in the UI. */
  did?: string | null;
  /** Build the page shell with inline styles and no external files. */
  inline?: boolean;
  /** Called after each page render for the publish progress UI. */
  onProgress?: (done: number, total: number) => void;
}

const RESERVED_PATHS = new Set([
  "assets",
  "fonts",
  "_redirects",
  ".well-known",
  "search.json",
  "sitemap.xml",
  "feed.xml",
  "robots.txt",
  "404.html",
  "index.html",
]);

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ttf: "font/ttf",
  otf: "font/otf",
  ttc: "font/collection",
  woff: "font/woff",
  woff2: "font/woff2",
  pdf: "application/pdf",
};

export function siteMime(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";

  return MIME_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Builds the public site bundle. The workspace stays the source; this module
 * never writes to it. Every page compile runs against a page allowlist so
 * queries and embeds cannot pull private notes into public HTML.
 */
export async function buildSite(
  store: WorkspaceStore,
  site: SiteSettings,
  options: SiteBuildOptions = {},
): Promise<SiteBuild> {
  const settings = store.getSettings();
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const name = site.name.trim() || settings.name;
  const slug = siteSlug(site.slug || name || "site");
  setPublishRequestStore(store);
  const palette = publishThemePalette(settings, { theme: site.theme });
  const allPages = store.listPages();
  const categories = store.listCategories();
  const included: Array<{
    page: PageMeta;
    config: SitePageSettings;
    visibility: "public" | "unlisted";
  }> = [];

  for (const page of allPages) {
    const config = site.pages[page.id] ?? {};
    const visibility = config.visibility ?? site.defaultVisibility;
    if (visibility === "private") continue;
    included.push({ page, config, visibility });
  }

  if (!included.length) {
    throw new Error(
      "No pages are included in this site. Set at least one page to public or unlisted.",
    );
  }

  const homeId = resolveHomePage(site, settings.homePageId, included);
  const warnings: string[] = [];
  const pageUrls = allocatePageUrls(included, homeId, warnings);
  const allowedIds = new Set(included.map((entry) => entry.page.id));
  const pages: SiteBuildPage[] = [];
  const imageFiles = new Map<string, SiteBuildFile>();
  let renderedPages = 0;

  for (const entry of included) {
    const { page, config, visibility } = entry;
    const source = await store.loadPageText(page.id);
    preflightSource(page, source, allowedIds, warnings);

    const context = typstContextBinding(
      pageContext(
        included.map((candidate) => candidate.page),
        page,
      ),
    );
    const prelude = await publishPrelude(settings, {
      theme: site.theme,
      paged: false,
      context,
    });
    const rendered = await renderInWorker({
      pagePath: page.path,
      source,
      prelude,
      wants: "html",
      spaceId: store.workspaceId,
      pageId: page.id,
      theme: palette,
      scope: {
        pageIds: [...allowedIds],
        site: true,
        currentPage: page.id,
      },
    });
    const error = firstError(rendered.diagnostics);
    if (error) throw new Error(`${page.title}: ${error}`);
    if (!rendered.html) throw new Error(`${page.title}: the render produced no HTML.`);

    const url = pageUrls.get(page.id)!;
    const root = rootPrefix(url);
    const body = extractBody(rendered.html);
    const headCss = extractStyles(rendered.html);
    const text = htmlToText(body);
    const links = rewriteLinks(body, pageUrls, root, warnings);
    const withAssets = await extractImages(links, root, imageFiles);
    const title = pageTitle(config, page);
    const description = pageDescription(config, page, source, text);
    const tags = config.tags ?? page.tags;
    const html = await renderShell({
      site,
      settings,
      palette,
      name,
      title,
      description,
      url,
      baseUrl,
      root,
      body: withAssets,
      headCss,
      navigation: buildNavigation(included, site, pageUrls, categories),
      currentPageId: page.id,
      updatedAt: page.updatedAt,
      noindex: visibility === "unlisted",
      standalone: options.inline,
    });

    pages.push({
      id: page.id,
      title,
      description,
      tags,
      sourcePath: page.path,
      url,
      file: pageFile(url),
      visibility,
      updatedAt: page.updatedAt,
      createdAt: page.createdAt,
      includeInSearch: config.includeInSearch !== false,
      includeInFeed: config.includeInFeed !== false,
      source,
      html,
      text,
    });
    renderedPages++;
    options.onProgress?.(renderedPages, included.length);
  }

  const navigation = buildNavigation(included, site, pageUrls, categories);
  const files: SiteBuildFile[] = [];
  for (const page of pages) {
    files.push({
      name: page.file,
      bytes: new TextEncoder().encode(page.html),
      mimeType: siteMime(page.file),
    });
  }

  if (!homeId) {
    const homeHtml = await renderHomeIndex({
      site,
      settings,
      palette,
      name,
      baseUrl,
      navigation,
      pages,
      standalone: options.inline,
    });
    files.push({
      name: "index.html",
      bytes: new TextEncoder().encode(homeHtml),
      mimeType: siteMime("index.html"),
    });
  }

  const searchable = pages.filter((page) => page.visibility === "public" && page.includeInSearch);
  if (site.showSearch) {
    const index = searchable.map((page) => ({
      title: page.title,
      url: page.url,
      description: page.description,
      text: page.text.slice(0, 1200),
    }));
    files.push({
      name: "search.json",
      bytes: new TextEncoder().encode(JSON.stringify(index)),
      mimeType: siteMime("search.json"),
    });
  }

  const fonts = await collectFonts(store);
  files.push(...fonts.files, ...imageFiles.values());
  const css = siteStyles({
    site,
    settings,
    palette,
    fonts: fonts.faces,
    inline: options.inline,
  });
  files.push({
    name: "assets/site.css",
    bytes: new TextEncoder().encode(css),
    mimeType: siteMime("assets/site.css"),
  });
  files.push({
    name: "assets/site.js",
    bytes: new TextEncoder().encode(siteScript()),
    mimeType: siteMime("assets/site.js"),
  });

  if (baseUrl) {
    const publicPages = pages.filter((page) => page.visibility === "public");
    if (site.includeSitemap) {
      files.push({
        name: "sitemap.xml",
        bytes: new TextEncoder().encode(sitemap(publicPages, baseUrl)),
        mimeType: siteMime("sitemap.xml"),
      });
      files.push({
        name: "robots.txt",
        bytes: new TextEncoder().encode(robots(baseUrl)),
        mimeType: siteMime("robots.txt"),
      });
    }
    if (site.includeFeed) {
      files.push({
        name: "feed.xml",
        bytes: new TextEncoder().encode(feed(name, pages, baseUrl)),
        mimeType: siteMime("feed.xml"),
      });
    }
  }

  const notFoundHtml = await renderNotFound({
    site,
    settings,
    palette,
    name,
    baseUrl,
    navigation,
    standalone: options.inline,
  });
  files.push({
    name: "404.html",
    bytes: new TextEncoder().encode(notFoundHtml),
    mimeType: siteMime("404.html"),
  });

  const unique = dedupeFiles(files);
  const totalBytes = unique.reduce((sum, file) => sum + file.bytes.length, 0);
  if (unique.length > 1000) {
    throw new Error(
      `This site has ${unique.length} files. Wisp accepts at most 1000 files per site.`,
    );
  }
  if (totalBytes > 300 * 1024 * 1024) {
    throw new Error(
      "This site is larger than 300 MB. Exclude media or split it into another site.",
    );
  }

  return {
    name,
    slug,
    baseUrl,
    files: unique,
    pages,
    navigation,
    warnings,
    totalBytes,
    hash: buildHash(unique, pages),
    standard: {
      publication: {
        url: baseUrl,
        name,
        description: site.description.trim(),
        palette,
      },
      documents: pages
        .filter((page) => page.visibility === "public")
        .map((page) => ({
          pageId: page.id,
          path: page.url,
          title: page.title,
          description: page.description,
          tags: page.tags,
          textContent: page.text.slice(0, 30_000),
          publishedAt: new Date(page.createdAt).toISOString(),
          updatedAt: new Date(page.updatedAt).toISOString(),
        })),
    },
  };
}

/**
 * Adds Standard.site verification and document links after the records have
 * been written, when their AT URIs are known. The `.well-known` file is only
 * useful on a domain root, so a shared `sites.wisp.place/...` URL skips it.
 */
export function applyStandardRecords(
  build: SiteBuild,
  publicationUri: string,
  documentUris: Map<string, string>,
): SiteBuild {
  const shared = isSharedWispUrl(build.baseUrl);
  const files = build.files.map((file) => {
    const page = build.pages.find((candidate) => candidate.file === file.name);
    if (!page) return file;

    let html = new TextDecoder().decode(file.bytes);
    html = html.replace(
      /<meta name="typbase-standard-publication"[^>]*>/,
      `<link rel="site.standard.publication" href="${escapeHtml(publicationUri)}">`,
    );
    const documentUri = documentUris.get(page.id);
    html = html.replace(
      /<meta name="typbase-standard-document"[^>]*>/,
      documentUri ? `<link rel="site.standard.document" href="${escapeHtml(documentUri)}">` : "",
    );

    return { ...file, bytes: new TextEncoder().encode(html) };
  });

  if (!shared && build.baseUrl) {
    files.push({
      name: ".well-known/site.standard.publication",
      bytes: new TextEncoder().encode(`${publicationUri}\n`),
      mimeType: "text/plain",
    });
  }

  return {
    ...build,
    files: dedupeFiles(files),
    standard: { ...build.standard, publication: { ...build.standard.publication } },
  };
}

/** The public site URL the app should show before/after a deploy. */
export function siteBaseUrl(site: SiteSettings, did: string | null | undefined): string {
  if (site.wisp.domainStatus === "verified" && site.wisp.customDomain.trim()) {
    return `https://${site.wisp.customDomain
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")}`;
  }
  if (site.wisp.domainStatus === "verified" && site.wisp.subdomain.trim()) {
    return `https://${site.wisp.subdomain.trim()}.wisp.place`;
  }
  if (site.wisp.lastDeploy?.url) return site.wisp.lastDeploy.url;
  if (did) {
    let host = "wisp.place";
    let protocol = "https:";
    try {
      const url = new URL(site.wisp.serviceUrl);
      host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
      protocol = url.protocol === "http:" ? "http:" : "https:";
    } catch {
      // Keep the public host for a malformed service URL.
    }
    const siteHost = host === "wisp.place" ? "sites.wisp.place" : `sites.${host}`;

    return `${protocol}//${siteHost}/${did}/${siteRkey(site, "site")}`;
  }

  return "";
}

export function isSharedWispUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "sites.wisp.place";
  } catch {
    return false;
  }
}

function resolveHomePage(
  site: SiteSettings,
  workspaceHome: string | null,
  included: Array<{ page: PageMeta; visibility: "public" | "unlisted" }>,
): string | null {
  const wanted = site.homePageId || workspaceHome;

  return wanted && included.some((entry) => entry.page.id === wanted) ? wanted : null;
}

function allocatePageUrls(
  included: Array<{ page: PageMeta; config: SitePageSettings; visibility: "public" | "unlisted" }>,
  homeId: string | null,
  warnings: string[],
): Map<string, string> {
  const urls = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of included) {
    if (entry.page.id === homeId) {
      urls.set(entry.page.id, "/");
      used.add("");
      continue;
    }

    const configured = entry.config.slug?.trim();
    const raw = configured
      ? configured
      : entry.page.path.replace(/\.typ$/i, "").replace(/^pages\//, "");
    let segments = raw
      .split("/")
      .map((segment) => siteSlug(segment))
      .filter(Boolean);
    if (!segments.length) segments = [siteSlug(entry.page.title)];
    if (RESERVED_PATHS.has(segments[0]!)) segments.unshift("pages");

    let url = `/${segments.join("/")}/`;
    if (used.has(segments.join("/"))) {
      url = `/${[...segments, entry.page.id].join("/")}/`;
      warnings.push(`${entry.page.title} has a duplicate public path, so its id was appended.`);
    }
    used.add(url.slice(1, -1));
    urls.set(entry.page.id, url);
  }

  return urls;
}

function pageFile(url: string): string {
  return url === "/" ? "index.html" : `${url.slice(1)}index.html`;
}

function pageTitle(config: SitePageSettings, page: PageMeta): string {
  return config.title?.trim() || page.title;
}

function pageDescription(
  config: SitePageSettings,
  page: PageMeta,
  source: string,
  text: string,
): string {
  if (config.description?.trim()) return config.description.trim();
  const paragraph = source
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) => line && !line.startsWith("=") && !line.startsWith("#") && !line.startsWith("//"),
    );
  const clean = (paragraph || text)
    .replace(/[*_`$#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean === page.title) return "";

  return clean.length > 280 ? `${clean.slice(0, 277)}...` : clean;
}

function preflightSource(
  page: PageMeta,
  source: string,
  allowed: Set<string>,
  warnings: string[],
): void {
  for (const match of source.matchAll(/#typbase\.embed\(\s*"([^"]+)"/g)) {
    const id = match[1]!;
    if (id === page.id) {
      warnings.push(`${page.title} embeds itself, so the embed is skipped.`);

      continue;
    }
    if (!isSiteEmbedAllowed(page.id, id, allowed)) {
      throw new Error(
        `${page.title} embeds ${id}, which is private in this site. Include that page or remove the embed.`,
      );
    }
  }
  for (const match of source.matchAll(/typbase:\/\/page\/([A-Za-z0-9_-]+)/g)) {
    const id = match[1]!;
    if (!allowed.has(id)) warnings.push(`${page.title} links to a page that is not published.`);
  }
  if (source.includes("typbase://plugin/")) {
    warnings.push(
      `${page.title} links to a plugin, which has no static site target. The link is removed.`,
    );
  }
}

function extractBody(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (body?.[1] !== undefined) return body[1];
  const withoutHead = html.replace(/<!doctype[^>]*>/i, "").replace(/<head[\s\S]*?<\/head>/i, "");

  return withoutHead;
}

function extractStyles(html: string): string {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const styles = head.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];

  return styles
    .map((style) => style.replace(/^<style[^>]*>/i, "").replace(/<\/style>$/i, ""))
    .join("\n");
}

function rewriteLinks(
  html: string,
  urls: Map<string, string>,
  root: string,
  warnings: string[],
): string {
  return html
    .replace(/href=(["'])typbase:\/\/page\/([^"']+)\1/gi, (_match, quote: string, id: string) => {
      const target = urls.get(id);
      if (!target) {
        warnings.push(`A link to ${id} was removed because that page is private.`);

        return "data-typbase-unpublished";
      }

      return `href=${quote}${relativeUrl(root, target)}${quote}`;
    })
    .replace(/href=(["'])typbase:\/\/plugin\/[^"']*\1/gi, "data-typbase-plugin")
    .replace(/href=(["'])typbase:\/\/page\/[^"']*\1/gi, "data-typbase-unpublished");
}

function rootPrefix(url: string): string {
  const depth = url.split("/").filter(Boolean).length;

  return depth ? "../".repeat(depth) : "./";
}

/** A link from a page root to a public path. */
function relativeUrl(root: string, target: string): string {
  if (target === "/") return root;
  const path = target.replace(/^\//, "");

  return `${root}${path}`;
}

async function extractImages(
  html: string,
  root: string,
  files: Map<string, SiteBuildFile>,
): Promise<string> {
  const matches = [...html.matchAll(/src=(["'])data:([^;,]+)(;base64)?,([^"']*)\1/gi)];
  let output = html;
  for (const match of matches) {
    const [source, , mime, base64, payload] = match;
    if (!source || !mime || payload === undefined) continue;
    try {
      const bytes = base64
        ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(payload));
      const extension = extensionFor(mime);
      const hash = await sha256Hex(bytes);
      const name = `assets/${hash}.${extension}`;
      files.set(name, { name, bytes, mimeType: mime });
      output = output.replace(source, `src="${root}${name}"`);
    } catch {
      // Leave data URIs Typst emitted in a shape this regex does not decode.
    }
  }

  return output;
}

function extensionFor(mime: string): string {
  const known = Object.entries(MIME_TYPES).find(([, value]) => value.split(";")[0] === mime);

  return known?.[0] ?? "bin";
}

async function collectFonts(store: WorkspaceStore): Promise<{
  files: SiteBuildFile[];
  faces: Array<{ family: string; file: string; weight: number; style: "normal" | "italic" }>;
}> {
  const bundled = await fontFiles(store);
  const customFamilies = store.getSettings().customFonts.map((font) => font.family);
  const files: SiteBuildFile[] = [];
  const faces: Array<{ family: string; file: string; weight: number; style: "normal" | "italic" }> =
    [];

  for (const font of bundled) {
    const name = font.name.split("/").pop() ?? "font";
    const file = `fonts/${name}`;
    files.push({ name: file, bytes: font.bytes, mimeType: siteMime(file) });
    const face = faceForBundled(name) ?? faceForCustom(name, customFamilies);
    if (face) faces.push({ ...face, file });
  }

  return { files, faces };
}

function faceForCustom(
  name: string,
  families: string[],
): { family: string; weight: number; style: "normal" | "italic" } | null {
  const family = families.find((candidate) =>
    name.startsWith(`${candidate.replace(/[^\w.-]+/g, "-")}-`),
  );

  return family ? { family, weight: 400, style: "normal" } : null;
}

function faceForBundled(name: string): {
  family: string;
  weight: number;
  style: "normal" | "italic";
} | null {
  if (name.startsWith("MapleMono-")) {
    return {
      family: "Maple Mono",
      weight: name.includes("Bold") ? 700 : 400,
      style: name.includes("Italic") ? "italic" : "normal",
    };
  }
  if (name.startsWith("NewCMMath-")) {
    return {
      family: "New Computer Modern Math",
      weight: name.includes("Bold") ? 700 : 400,
      style: "normal",
    };
  }

  return null;
}

function buildNavigation(
  included: Array<{ page: PageMeta; config: SitePageSettings; visibility: "public" | "unlisted" }>,
  site: SiteSettings,
  urls: Map<string, string>,
  categories: Array<{ id: string; name: string }>,
): SiteBuildNavigationGroup[] {
  const visible = included.filter(
    (entry) => entry.visibility === "public" && !entry.config.hiddenFromNav,
  );
  const byCategory = new Map<string | null, typeof visible>();
  for (const entry of visible) {
    const key = entry.page.categoryId ?? null;
    const group = byCategory.get(key);
    if (group) group.push(entry);
    else byCategory.set(key, [entry]);
  }

  const groups: SiteBuildNavigationGroup[] = [];
  for (const [categoryId, entries] of byCategory) {
    const category = categoryId
      ? (categories.find((candidate) => candidate.id === categoryId) ?? null)
      : null;
    groups.push({
      id: categoryId,
      name:
        category?.name ?? (categoryId ? "Pages" : site.navigation === "top" ? "Pages" : "General"),
      pages: entries.map((entry) => ({
        id: entry.page.id,
        title: entry.config.title?.trim() || entry.page.title,
        url: urls.get(entry.page.id)!,
        updatedAt: entry.page.updatedAt,
      })),
    });
  }

  return groups;
}

function dedupeFiles(files: SiteBuildFile[]): SiteBuildFile[] {
  const map = new Map<string, SiteBuildFile>();
  for (const file of files) {
    if (map.has(file.name)) throw new Error(`Two site files would both be named ${file.name}.`);
    map.set(file.name, file);
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildHash(files: SiteBuildFile[], pages: SiteBuildPage[]): string {
  let hash = 0x811c9dc5;
  const update = (value: string): void => {
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const file of files) update(`${file.name}:${file.bytes.length};`);
  for (const page of pages) update(`${page.id}:${page.updatedAt};${page.url};`);

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function firstError(diagnostics: unknown[] | undefined): string | null {
  for (const entry of diagnostics ?? []) {
    const diagnostic = entry as { severity?: string; message?: string };
    if (diagnostic.severity === "error" && diagnostic.message) return diagnostic.message;
  }

  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
