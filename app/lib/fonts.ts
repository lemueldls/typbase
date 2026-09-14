/**
 * Families a document asks for with `font: "..."` (including tuples and
 * `#set text(font: ...)`). The wasm font book loads only what is used, so
 * page text feeds these into the on-demand loader on page open.
 */
export function fontFamiliesInSource(source: string): string[] {
  const families = new Set<string>();

  for (const match of source.matchAll(/font\s*:\s*"([^"]+)"/g)) {
    const family = match[1]?.trim();
    if (family) families.add(family);
  }

  return [...families];
}
