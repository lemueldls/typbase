import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { render } from "takumi-js";

import { socialCardHtml } from "../../apps/web/src/lib/site/socialTemplate.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = `${root}apps/web/public/og-image.png`;

const [icon, regular, bold] = await Promise.all([
  readFile(`${root}apps/web/public/app-icon.png`),
  readFile(`${root}apps/web/public/fonts/maple/MapleMono-Regular.ttf`),
  readFile(`${root}apps/web/public/fonts/maple/MapleMono-Bold.ttf`),
]);

const html = socialCardHtml({
  title: "Knowledge in Typst.\nYours on the Atmosphere.",
  description:
    "Write, query, and publish a knowledge base that can stay local and travel with you.",
  siteName: "Typbase",
  eyebrow: "LOCAL-FIRST KNOWLEDGE BASE",
  host: "typbase.at",
  footerRight: "Typst · Loro · atproto",
  palette: {
    surface: "#18191a",
    surface2: "#202223",
    border: "#35393a",
    text: "#e8e9e8",
    textSecondary: "#a0a8a5",
    accent: "#7fc4bc",
  },
  icon: `data:image/png;base64,${icon.toString("base64")}`,
});

const png = await render(html, {
  width: 1200,
  height: 630,
  format: "png",
  fonts: [
    { name: "Maple Mono", data: regular, weight: 400 },
    { name: "Maple Mono", data: bold, weight: 700 },
  ],
});

await writeFile(output, png);
console.log(`wrote ${output}`);
