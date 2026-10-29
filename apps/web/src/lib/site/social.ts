import type { ThemePaletteTokens } from "@typbase/typing";

import { siteSlug } from "./slug";

/** Open Graph and Twitter cards use the same 1.91:1 image. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** A deterministic bundle path for a generated site card. */
export function socialImagePath(
  key: string,
  title: string,
  description: string,
  siteName: string,
  palette: ThemePaletteTokens,
): string {
  const hash = shortHash(
    [key, title, description, siteName, JSON.stringify(palette)].join("\u0000"),
  );

  return `assets/og/${siteSlug(title)}-${hash}.png`;
}

export function socialImageAlt(title: string, siteName: string): string {
  const cleanTitle = title.trim();
  const cleanSite = siteName.trim();
  if (!cleanTitle) return cleanSite;
  if (!cleanSite || cleanTitle === cleanSite) return cleanTitle;

  return `${cleanTitle} · ${cleanSite}`;
}

/** Open Graph locale codes use an underscore, unlike the workspace locale. */
export function ogLocale(locale: string): string {
  const languages: Record<string, string> = {
    en: "en_US",
    de: "de_DE",
    es: "es_ES",
    fr: "fr_FR",
    zh: "zh_CN",
  };

  return languages[locale] ?? locale.replaceAll("-", "_");
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
