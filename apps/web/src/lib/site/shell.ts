import type { SiteSettings, ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import siteCss from "virtual:typbase-site-css";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

import type { SiteBuildNavigationGroup, SiteBuildPage } from "./build";

import SiteDocument from "../../components/site/SiteDocument.vue";
import { siteSlug } from "./slug";
import searchScript from "./templates/site.js?raw";
import { absoluteUrl, relativeUrl } from "./urls";

export { absoluteUrl, relativeUrl };

interface ShellInput {
  site: SiteSettings;
  settings: WorkspaceSettings;
  /** Kept in the input shape for callers; the document gets the resolved CSS. */
  palette?: ThemePaletteTokens;
  name: string;
  title: string;
  description: string;
  url: string;
  baseUrl: string;
  root: string;
  body: string;
  headCss: string;
  navigation: SiteBuildNavigationGroup[];
  currentPageId: string;
  updatedAt?: number;
  noindex?: boolean;
  standalone?: boolean;
}

/**
 * Renders one static site document. Vue's SSR renderer gives the templates a
 * real component model, so the site shell is markup rather than a long HTML
 * string. The result is plain HTML: nothing hydrates on the published site.
 */
export async function renderShell(input: ShellInput): Promise<string> {
  const { body, toc } = decorateHeadings(input.body);
  const app = createSSRApp(SiteDocument, {
    site: input.site,
    lang: input.settings.locale === "auto" ? "en" : input.settings.locale,
    name: input.name,
    title: input.title,
    description: input.description,
    url: input.url,
    baseUrl: input.baseUrl,
    root: input.root,
    body,
    headCss: input.headCss,
    navigation: input.navigation,
    toc,
    currentPageId: input.currentPageId,
    updatedAt: input.updatedAt,
    noindex: input.noindex,
  });

  const html = await renderToString(app);

  // Vue's SSR output marks conditional and fragment boundaries with comments.
  // They are meaningful to a hydrating client and noise in a static site.
  return `<!doctype html>${html
    .replaceAll("<!--v-if-->", "")
    .replaceAll("<!--[-->", "")
    .replaceAll("<!--]-->", "")
    .replaceAll("<!---->", "")}`;
}

export async function renderHomeIndex(input: {
  site: SiteSettings;
  settings: WorkspaceSettings;
  palette?: ThemePaletteTokens;
  name: string;
  baseUrl: string;
  navigation: SiteBuildNavigationGroup[];
  pages: SiteBuildPage[];
  standalone?: boolean;
}): Promise<string> {
  const { name, navigation, pages, site } = input;
  const groups = navigation
    .map(
      (group) => `<section class="site-index__group">
      <h2>${escapeHtml(group.name)}</h2>
      <ul>${group.pages
        .map(
          (page) =>
            `<li><a href="${relativeUrl("./", page.url)}">${escapeHtml(page.title)}</a></li>`,
        )
        .join("")}</ul>
    </section>`,
    )
    .join("");
  const body = `<h1>${escapeHtml(name)}</h1>
${site.description ? `<p>${escapeHtml(site.description)}</p>` : ""}
${groups || `<p>${pages.length} page${pages.length === 1 ? "" : "s"} published.</p>`}`;

  return renderShell({
    site,
    settings: input.settings,
    palette: input.palette,
    name,
    title: name,
    description: site.description,
    url: "/",
    baseUrl: input.baseUrl,
    root: "./",
    body,
    headCss: "",
    navigation,
    currentPageId: "",
    standalone: input.standalone,
  });
}

export async function renderNotFound(input: {
  site: SiteSettings;
  settings: WorkspaceSettings;
  palette?: ThemePaletteTokens;
  name: string;
  baseUrl: string;
  navigation: SiteBuildNavigationGroup[];
  standalone?: boolean;
}): Promise<string> {
  return renderShell({
    ...input,
    site: { ...input.site, showSearch: false },
    title: "Page not found",
    description: "",
    url: "/404.html",
    root: "/",
    body: `<h1>Page not found</h1><p>This page does not exist or is no longer published.</p><p><a href="/">Back to ${escapeHtml(input.name)}</a></p>`,
    headCss: "",
    currentPageId: "",
  });
}

function decorateHeadings(body: string): {
  body: string;
  toc: Array<{ id: string; text: string; level: number }>;
} {
  const used = new Set<string>();
  const toc: Array<{ id: string; text: string; level: number }> = [];
  const output = body.replace(
    /<h([2-4])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level: string, attrs: string, inner: string) => {
      const text = htmlToText(inner);
      if (!text) return match;
      const existing = /\bid=(["'])([^"']+)\1/i.exec(attrs)?.[2];
      const base = siteSlug(text);
      let id = existing ?? base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      toc.push({ id, text, level: Number(level) });
      const nextAttrs = /\bid=/.test(attrs) ? attrs : `${attrs} id="${id}"`;

      return `<h${level}${nextAttrs}>${inner}</h${level}>`;
    },
  );

  return { body: output, toc };
}

export function siteStyles(input: {
  site: SiteSettings;
  settings: WorkspaceSettings;
  palette: ThemePaletteTokens;
  fonts: Array<{ family: string; file: string; weight: number; style: "normal" | "italic" }>;
  inline?: boolean;
}): string {
  const { palette, settings, fonts } = input;
  const dark = isDark(palette.surface);
  const fontFaces = fonts
    .map(
      (face) =>
        `@font-face{font-family:"${face.family.replace(/"/g, '\\"')}";src:url("../${face.file}") format("${face.file.endsWith(".otf") ? "opentype" : "truetype"}");font-weight:${face.weight};font-style:${face.style};font-display:swap;}`,
    )
    .join("\n");
  const textFont = settings.font || "Maple Mono";
  const codeFont = settings.codeFont || settings.font || "Maple Mono";
  const mathFont = settings.mathFont || "New Computer Modern Math";

  return `${fontFaces}
:root{
  color-scheme:${dark ? "dark" : "light"};
  --site-bg:${palette.surface};
  --site-surface:${palette.surface2};
  --site-surface-3:${palette.surface3};
  --site-text:${palette.text};
  --site-muted:${palette.textSecondary};
  --site-border:${palette.border};
  --site-accent:${palette.accent};
  --site-accent-soft:${palette.accentSoft};
  --site-code:${palette.code};
  --site-text-font:"${textFont}",ui-sans-serif,system-ui,sans-serif;
  --site-code-font:"${codeFont}",ui-monospace,SFMono-Regular,monospace;
  --site-math-font:"${mathFont}",serif;
}
${siteCss}`;
}

export function siteScript(): string {
  return searchScript;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function sitemap(pages: SiteBuildPage[], baseUrl: string): string {
  const entries = pages
    .filter((page) => page.visibility === "public")
    .map(
      (page) =>
        `  <url><loc>${escapeHtml(absoluteUrl(baseUrl, page.url))}</loc><lastmod>${new Date(page.updatedAt).toISOString()}</lastmod></url>`,
    );
  if (!pages.some((page) => page.url === "/")) {
    entries.unshift(`  <url><loc>${escapeHtml(absoluteUrl(baseUrl, "/"))}</loc></url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

export function robots(baseUrl: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl(baseUrl, "/sitemap.xml")}\n`;
}

export function feed(name: string, pages: SiteBuildPage[], baseUrl: string): string {
  const items = pages
    .filter((page) => page.visibility === "public" && page.includeInFeed)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)
    .map(
      (page) => `    <item>
      <title>${escapeHtml(page.title)}</title>
      <link>${escapeHtml(absoluteUrl(baseUrl, page.url))}</link>
      <guid>${escapeHtml(absoluteUrl(baseUrl, page.url))}</guid>
      <pubDate>${new Date(page.createdAt).toUTCString()}</pubDate>
      <description>${escapeHtml(page.description)}</description>
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(name)}</title>
    <link>${escapeHtml(baseUrl)}</link>
    <description>${escapeHtml(name)}</description>
${items}
  </channel>
</rss>
`;
}

function isDark(color: string): boolean {
  const match = /^#([0-9a-f]{6})/i.exec(color.trim());
  if (!match) return false;
  const value = Number.parseInt(match[1]!, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
