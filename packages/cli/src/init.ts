import type { Skin } from "@typbase/skin";
import type { ThemeSeedToken } from "@typbase/typing";

import { pluginSlug } from "@typbase/plugin-sdk";
import { expandSeeds, SKIN_SCHEMA_VERSION, THEME_FILE_SCHEMA } from "@typbase/skin";
import { DEFAULT_SETTINGS, THEME_SEED_KEYS } from "@typbase/typing";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIGHT_SEEDS: Record<ThemeSeedToken, string> = {
  surface: "#f9f9f8",
  surface2: "#f1f3f2",
  surface3: "#e7eae8",
  border: "#dbe0dd",
  borderStrong: "#c6ccc8",
  text: "#293133",
  textSecondary: "#66716f",
  accent: "#1f6f6b",
  ok: "#3f704e",
  warning: "#8f6a13",
  danger: "#b3443e",
  info: "#2f6f9f",
  red: "#b3443e",
  orange: "#a85c23",
  yellow: "#8f6a13",
  green: "#3f704e",
  cyan: "#2f6f9f",
  blue: "#2f6f9f",
  violet: "#6b538f",
  code: "#f1f4f2",
};

const DARK_SEEDS: Record<ThemeSeedToken, string> = {
  surface: "#18191a",
  surface2: "#202223",
  surface3: "#292c2d",
  border: "#35393a",
  borderStrong: "#4a4f50",
  text: "#e8e9e8",
  textSecondary: "#a0a8a5",
  accent: "#7fc4bc",
  ok: "#a3c794",
  warning: "#d8b46b",
  danger: "#e28f87",
  info: "#8bb6e0",
  red: "#e28f87",
  orange: "#dc9d6d",
  yellow: "#d8b46b",
  green: "#a3c794",
  cyan: "#8bb6e0",
  blue: "#8bb6e0",
  violet: "#b99bc7",
  code: "#121414",
};

function assertSeeds(seeds: Record<ThemeSeedToken, string>): void {
  for (const key of THEME_SEED_KEYS) {
    if (!seeds[key]) throw new Error(`template is missing seed "${key}"`);
  }
}

export function defaultSkin(): Skin {
  assertSeeds(LIGHT_SEEDS);
  assertSeeds(DARK_SEEDS);

  return {
    schema: SKIN_SCHEMA_VERSION,
    palette: {
      light: expandSeeds(LIGHT_SEEDS, "light"),
      dark: expandSeeds(DARK_SEEDS, "dark"),
    },
    geometry: {
      size: DEFAULT_SETTINGS.uiSize,
      density: DEFAULT_SETTINGS.uiDensity,
      radius: DEFAULT_SETTINGS.uiRadius,
    },
    typography: {
      font: DEFAULT_SETTINGS.font,
      mathFont: DEFAULT_SETTINGS.mathFont,
      codeFont: DEFAULT_SETTINGS.codeFont,
      textSize: DEFAULT_SETTINGS.textSize,
      ligatures: DEFAULT_SETTINGS.typography.ligatures,
      kerning: DEFAULT_SETTINGS.typography.kerning,
    },
  };
}

async function ensureDir(dir: string, force: boolean): Promise<void> {
  await mkdir(dir, { recursive: force });
}

function readmeTheme(name: string): string {
  return `# ${name}

A Typbase theme. Edit \`theme.json\`, then verify and publish it.

\`\`\`sh
typbase theme verify theme.json
typbase theme publish theme.json --identifier you.bsky.social
\`\`\`

The skin schema is \`${SKIN_SCHEMA_VERSION}\`. The theme file schema is \`${THEME_FILE_SCHEMA}\`.
Both palettes are explicit, so the theme works in light and dark mode.

Do not add CSS, fonts, images, or Typst code. A theme changes colors, geometry,
and typography family names only.
`;
}

function readmePlugin(name: string, slug: string): string {
  return `# ${name}

A Typbase plugin scaffold.

\`\`\`sh
typbase plugin verify .
typbase plugin build .
typbase plugin publish . --identifier you.bsky.social
\`\`\`

The manifest id is \`local:${slug}\` until publish rewrites it to your DID. Surfaces
use \`#import "/typbase/ui.typ": *\` and return \`surface(...)\`.
`;
}

export async function initTheme(dir: string, name: string, force: boolean): Promise<void> {
  await ensureDir(dir, force);
  const slug = pluginSlug(name);
  const theme = {
    $schema: "https://typbase.at/schemas/theme.json",
    schema: THEME_FILE_SCHEMA,
    name,
    description: "",
    license: "MIT",
    tags: ["custom"],
    skin: defaultSkin(),
  };

  await writeFile(path.join(dir, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`);
  await writeFile(path.join(dir, "README.md"), readmeTheme(name));
  await writeFile(path.join(dir, "LICENSE"), "MIT\n");
  await writeFile(path.join(dir, ".gitignore"), "dist/\n");
  void slug;
}

export async function initPlugin(dir: string, name: string, force: boolean): Promise<void> {
  await ensureDir(dir, force);
  const slug = pluginSlug(name);
  const manifest = {
    $schema: "https://typbase.at/schemas/plugin.json",
    id: `local:${slug}`,
    name,
    version: "0.1.0",
    description: "A Typbase plugin.",
    api: "typbase.host.v2",
    entry: "main.typ",
    icon: "extension",
    capabilities: ["plugin.data"],
    collections: {
      notes: {
        fields: {
          text: { type: "string" },
        },
      },
    },
    surfaces: [
      { kind: "widget", fn: "widget", title: name, icon: "extension" },
      { kind: "pane", fn: "pane", title: name, icon: "extension" },
    ],
  };

  await writeFile(path.join(dir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(dir, "main.typ"),
    `#import "/typbase/ui.typ": *

#let widget(ctx) = surface([
  #panel(title: "${name}", body: [
    #muted(body: "A sidebar widget.")
    #button("Add note", action: "note.add", kind: "primary")
  ])
])

#let pane(ctx) = {
  let patch = if ctx.action != none and ctx.action.name == "note.add" {
    ops-state((op-append("notes", (text: "New note")),))
  } else {
    (:)
  }

  surface([
    #panel(title: "${name}", body: [
      #muted(body: "A full pane.")
      #button("Add note", action: "note.add", kind: "primary")
      #for note in ctx.state.notes [
        #card(body: [#note.text])
      ]
    ])
  ], ..patch)
}
`,
  );
  await writeFile(
    path.join(dir, "style.css"),
    `/* Plugin-specific rules only. Host primitives live in surface.css. */\n`,
  );
  await writeFile(path.join(dir, "README.md"), readmePlugin(name, slug));
  await writeFile(path.join(dir, "LICENSE"), "MIT\n");
  await writeFile(path.join(dir, ".gitignore"), "dist/\n");
}
