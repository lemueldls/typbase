// Builds app/assets/symbols.json from two sources:
// - `material-symbols`'s type union (`node_modules/material-symbols/index.d.ts`)
//   lists every ligature the shipped woff2 knows, so the search index can
//   never show an icon the font can't render.
// - `metadata.json` (Google's font metadata, copied from the material-symbols
//   repo) carries the tag synonyms that make text search useful ("house"
//   finds `home`).
// Only names present in both make it out; tags for icons outside our glyph
// version would break rendering, so they are dropped.
// Run after bumping the font version: `node scripts/symbols/transform.mjs`.
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import metadata from "./metadata.json" with { type: "json" };

const dtsPath = fileURLToPath(
  new URL("../../node_modules/material-symbols/index.d.ts", import.meta.url),
);
const outPath = fileURLToPath(new URL("../../app/assets/symbols.json", import.meta.url));

const dts = await fs.readFile(dtsPath, "utf8");

const start = dts.indexOf("type MaterialSymbols = [");
if (start === -1) throw new Error("material-symbols/index.d.ts lost its MaterialSymbols union");
const end = dts.indexOf("];", start);
if (end === -1) throw new Error("MaterialSymbols union never closes");

const names = [...dts.slice(start, end).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);

const tagsByName = new Map(metadata.icons.map((icon) => [icon.name, icon.tags ?? []]));

function toTitle(name) {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const icons = names
  .filter((id) => tagsByName.has(id))
  .map((id) => ({ id, title: toTitle(id), synonyms: tagsByName.get(id) }));

await fs.writeFile(outPath, `${JSON.stringify(icons)}\n`);
console.log(
  `Wrote ${icons.length} symbols (${names.length - icons.length} glyphs without tags dropped) to ${outPath}`,
);
