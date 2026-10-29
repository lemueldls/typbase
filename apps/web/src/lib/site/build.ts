import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta, SitePageSettings, SiteSettings, ThemePaletteTokens } from "@typbase/typing";

import iconFontUrl from "material-symbols/material-symbols-rounded.woff2?url";

import { fontFacesOf } from "~/lib/customFonts";
import { fontFiles } from "~/lib/exportPage";
import { pageContext, typstContextBinding } from "~/lib/pageContext";
import { publishPrelude, publishThemePalette } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore } from "~/lib/renderWorker";

import { isSiteEmbedAllowed } from "./embeds";
import { buildSiteNavigation, type SiteNavigationGroup } from "./navigation";
import { renderSiteSocialImage, type SiteSocialFont } from "./ogImage";
import { siteRkey, siteSlug } from "./slug";
import { socialImageAlt, socialImagePath } from "./social";
import { absoluteUrl } from "./urls";

export { siteRkey, siteSlug } from "./slug";
export type { SiteNavigationPage } from "./navigation";

import {
  escapeHtml,
  feed,
  htmlToText,
  graphScript,
  renderHomeIndex,
  renderNotFound,
  renderShell,
  robots,
  siteScript,
  siteStyles,
  sitemap,
  type SiteFontFace,
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
  /** Absolute social image URL when the build generated one. */
  ogImage?: string;
  ogImageAlt?: string;
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
  /** Site-level social image URL, when generated. */
  ogImage?: string;
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

export type SiteBuildNavigationGroup = SiteNavigationGroup;

export interface SiteBuildOptions {
  /** Canonical origin and optional base path, without a trailing slash. */
  baseUrl?: string;
  /** Signed-in DID, used for the default shared Wisp URL in the UI. */
  did?: string | null;
  /** Build the page shell with inline styles and no external files. */
  inline?: boolean;
  /** Called after each page render for the publish progress UI. */
  onProgress?: (done: number, total: number) => void;
  /** Generate one card per page, one shared site card, or none. */
  socialImages?: "page" | "site" | "off";
}

const RESERVED_PATHS = new Set([
  "assets",
  "fonts",
  "_redirects",
  ".well-known",
  "search.json",
  "graph.json",
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
  const fontBundle = await collectFonts(store);
  const socialFont = socialFontFor(fontBundle, settings.font);
  const socialMode = options.socialImages ?? "page";
  let socialIconFont: SiteSocialFont | undefined;
  if (baseUrl && socialMode !== "off") {
    try {
      socialIconFont = {
        name: "Material Symbols Rounded",
        data: await materialSymbolsBytes(),
        weight: 400,
      };
    } catch {
      // The app icon remains the fallback when the icon font is unavailable.
    }
  }
  const socialFonts = socialIconFont ? [...socialFont.faces, socialIconFont] : socialFont.faces;
  const socialIconGlyph = socialIconFont
    ? (settings.icon || "folder").replaceAll("-", "_")
    : undefined;
  const socialFiles = new Map<string, Uint8Array>();
  let socialHost = "typbase.at";
  if (baseUrl) {
    try {
      socialHost = new URL(baseUrl).host;
    } catch {
      // Keep the product host for a malformed configured base URL.
    }
  }

  let siteOgUrl = "";
  let siteOgAlt = "";
  if (baseUrl && socialMode !== "off") {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await renderSiteSocialImage({
        title: name,
        description: site.description,
        siteName: name,
        palette,
        host: socialHost,
        iconGlyph: socialIconGlyph,
        fontFamily: socialFont.family,
        fonts: socialFonts,
      });
    } catch {
      // Social cards are optional. Keep the metadata without an image.
    }
    if (bytes) {
      const path = socialImagePath("site", name, site.description, name, palette);
      socialFiles.set(path, bytes);
      siteOgUrl = absoluteUrl(baseUrl, `/${path}`);
      siteOgAlt = socialImageAlt(name, name);
    }
  }

  const pageSocial = async (
    pageId: string,
    title: string,
    description: string,
  ): Promise<{ url?: string; alt?: string }> => {
    if (!baseUrl || socialMode === "off") return {};
    if (socialMode === "site") {
      return siteOgUrl ? { url: siteOgUrl, alt: siteOgAlt } : {};
    }

    const imageDescription = description;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await renderSiteSocialImage({
        title,
        description: imageDescription,
        siteName: name,
        palette,
        host: socialHost,
        iconGlyph: socialIconGlyph,
        fontFamily: socialFont.family,
        fonts: socialFonts,
      });
    } catch {
      // Fall back to the site card when this page cannot be drawn.
    }
    if (!bytes) {
      return siteOgUrl ? { url: siteOgUrl, alt: siteOgAlt } : {};
    }

    const path = socialImagePath(pageId, title, imageDescription, name, palette);
    socialFiles.set(path, bytes);

    return {
      url: absoluteUrl(baseUrl, `/${path}`),
      alt: socialImageAlt(title, name),
    };
  };

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
  const linksByPage = new Map<string, string[]>();
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
    const body = wrapMath(extractBody(rendered.html));
    const headCss = extractStyles(rendered.html);
    const text = htmlToText(body);
    const pageLinks = pageLinkTargets(body, allowedIds);
    const links = rewriteLinks(body, pageUrls, root, warnings);
    const withAssets = await extractImages(links, root, imageFiles);
    const title = pageTitle(config, page);
    const description = pageDescription(config);
    const tags = config.tags ?? page.tags;
    const social = await pageSocial(page.id, title, description);
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
      navigation: siteNavigation(included, site, pageUrls, categories),
      currentPageId: page.id,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      ogImage: social.url,
      ogImageAlt: social.alt,
      ogType: "article",
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
      ogImage: social.url,
      ogImageAlt: social.alt,
    });
    linksByPage.set(page.id, pageLinks);
    renderedPages++;
    options.onProgress?.(renderedPages, included.length);
  }

  const navigation = siteNavigation(included, site, pageUrls, categories);
  const files: SiteBuildFile[] = [];
  for (const [path, bytes] of socialFiles) {
    files.push({ name: path, bytes, mimeType: "image/png" });
  }
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
      ogImage: siteOgUrl || undefined,
      ogImageAlt: siteOgAlt || undefined,
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

  if (site.showGraph) {
    const graphData = siteGraph(pages, linksByPage);
    files.push({
      name: "graph.json",
      bytes: new TextEncoder().encode(JSON.stringify(graphData)),
      mimeType: siteMime("graph.json"),
    });
  }

  files.push(...fontBundle.files, ...imageFiles.values());
  if (site.showIcons) {
    files.push({
      name: "fonts/MaterialSymbolsRounded.woff2",
      bytes: await materialSymbolsBytes(),
      mimeType: siteMime("fonts/MaterialSymbolsRounded.woff2"),
    });
  }
  const css = siteStyles({
    site,
    settings,
    palette,
    fonts: fontBundle.faces,
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
  if (site.showGraph) {
    files.push({
      name: "assets/site-graph.js",
      bytes: new TextEncoder().encode(graphScript()),
      mimeType: siteMime("assets/site-graph.js"),
    });
  }

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
    ogImage: siteOgUrl || undefined,
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

function pageDescription(config: SitePageSettings): string {
  return config.description?.trim() ?? "";
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

/** Wide display equations scroll in their own box instead of widening the page. */
function wrapMath(html: string): string {
  return html.replace(
    /<math\b[^>]*\bdisplay=(["'])block\1[^>]*>[\s\S]*?<\/math>/gi,
    (math) => `<div class="site-math-scroll">${math}</div>`,
  );
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

function pageLinkTargets(html: string, known: Set<string>): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/href=(["'])typbase:\/\/page\/([^"'?#]+)\1/gi)) {
    const id = match[2];
    if (id && known.has(id)) ids.add(id);
  }

  return [...ids];
}

/** The public page graph, keyed by public URLs rather than workspace page ids. */
function siteGraph(
  pages: SiteBuildPage[],
  linksByPage: Map<string, string[]>,
): {
  nodes: Array<{ id: string; title: string; url: string }>;
  edges: Array<{ source: string; target: string }>;
} {
  const publicPages = pages.filter((page) => page.visibility === "public");
  const byId = new Map(publicPages.map((page) => [page.id, page]));
  const edges: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();

  for (const page of publicPages) {
    for (const targetId of linksByPage.get(page.id) ?? []) {
      const target = byId.get(targetId);
      if (!target || target.id === page.id) continue;
      const key = `${page.id}\0${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: page.url, target: target.url });
    }
  }

  return {
    nodes: publicPages.map((page) => ({ id: page.url, title: page.title, url: page.url })),
    edges,
  };
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

let materialSymbolsPromise: Promise<Uint8Array> | undefined;

async function materialSymbolsBytes(): Promise<Uint8Array> {
  if (!materialSymbolsPromise) {
    materialSymbolsPromise = fetch(iconFontUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load the Material Symbols font (${response.status}).`);
      }

      return new Uint8Array(await response.arrayBuffer());
    });
  }

  return materialSymbolsPromise;
}

async function collectFonts(store: WorkspaceStore): Promise<{
  files: SiteBuildFile[];
  faces: SiteFontFace[];
}> {
  const bundled = await fontFiles(store);
  const customFamilies = store.getSettings().customFonts.map((font) => font.family);
  const files: SiteBuildFile[] = [];
  const faces: SiteFontFace[] = [];

  for (const font of bundled) {
    const name = font.name.split("/").pop() ?? "font";
    const file = `fonts/${name}`;
    files.push({ name: file, bytes: font.bytes, mimeType: siteMime(file) });

    // The file carries the real weight and style. Filename guesses put every
    // Iosevka face in a family at 400 normal, so the browser picked one file
    // for the whole page, often an italic or semibold face.
    const detected = fontFacesOf(font.bytes);
    if (detected.length) {
      for (const face of detected) {
        faces.push({
          family: face.family,
          file,
          weight: face.weight,
          style: face.style,
        });
      }
      continue;
    }

    const fallback = faceForBundled(name) ?? faceForCustom(name, customFamilies);
    if (fallback) faces.push({ ...fallback, file });
  }

  return { files, faces };
}

function socialFontFor(
  bundle: { files: SiteBuildFile[]; faces: SiteFontFace[] },
  family: string,
): { family: string; faces: SiteSocialFont[] } {
  const byName = new Map(bundle.files.map((file) => [file.name, file.bytes]));
  const faces: SiteSocialFont[] = [];

  for (const face of bundle.faces) {
    if (face.family !== family) continue;
    const data = byName.get(face.file);
    if (data) {
      faces.push({ name: face.family, data, weight: face.weight, style: face.style });
    }
  }

  if (faces.length) return { family, faces };

  // A custom family can be configured before its file reaches this device.
  // Maple Mono is already part of the site bundle, so keep the card readable.
  for (const face of bundle.faces) {
    if (face.family !== "Maple Mono") continue;
    const data = byName.get(face.file);
    if (data) {
      faces.push({ name: face.family, data, weight: face.weight, style: face.style });
    }
  }

  return { family: "Maple Mono", faces };
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

function siteNavigation(
  included: Array<{ page: PageMeta; config: SitePageSettings; visibility: "public" | "unlisted" }>,
  site: SiteSettings,
  urls: Map<string, string>,
  categories: Array<{ id: string; name: string }>,
): SiteBuildNavigationGroup[] {
  return buildSiteNavigation(
    included.map((entry) => ({
      page: entry.page,
      config: entry.config,
      visibility: entry.visibility,
      url: urls.get(entry.page.id)!,
    })),
    categories,
    site.navigation,
  );
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
