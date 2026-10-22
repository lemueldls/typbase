import type { SiteSettings } from "@typbase/typing";

/** URL segment for a page or site. Unicode letters survive. */
export function siteSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "site";
}

/** Wisp record key: the rkey grammar only accepts ASCII. */
export function siteRkey(site: SiteSettings, fallback: string): string {
  return asciiSlug(site.wisp.siteRkey || site.slug || site.name || fallback);
}

function asciiSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (slug) return slug;

  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `site-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
