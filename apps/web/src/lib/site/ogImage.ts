import type { ThemePaletteTokens } from "@typbase/typing";

import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "./social";
import { socialCardHtml } from "./socialTemplate";

/**
 * Renders a social card from the same palette the published site uses. The
 * site build runs in the browser, so Takumi is loaded through its browser
 * bindings only when a site is built or previewed.
 */
export interface SiteSocialImageInput {
  title: string;
  description: string;
  siteName: string;
  palette: ThemePaletteTokens;
  host?: string;
  /** The workspace Material Symbol name. */
  iconGlyph?: string;
  /** The site's effective text family, with matching face files. */
  fontFamily?: string;
  fonts?: SiteSocialFont[];
}

export interface SiteSocialFont {
  name: string;
  data: Uint8Array;
  weight: number;
  style?: string;
}

let fontsPromise: Promise<SiteSocialFont[]> | undefined;
let iconPromise: Promise<string | null> | undefined;

export async function renderSiteSocialImage(
  input: SiteSocialImageInput,
): Promise<Uint8Array | null> {
  if (typeof window === "undefined") return null;

  const [{ render }, icon] = await Promise.all([
    import("takumi-js"),
    input.iconGlyph ? Promise.resolve(null) : loadIcon(),
  ]);
  const fonts = input.fonts?.length ? input.fonts : await loadFonts();

  const html = socialCardHtml({
    title: input.title,
    description: input.description,
    siteName: input.siteName,
    host: input.host || "typbase.at",
    iconGlyph: input.iconGlyph,
    fontFamily: input.fontFamily || "Maple Mono",
    palette: {
      surface: input.palette.surface,
      surface2: input.palette.surface2,
      border: input.palette.border,
      text: input.palette.text,
      textSecondary: input.palette.textSecondary,
      accent: input.palette.accent,
    },
    icon: icon || undefined,
  });

  const png = await render(html, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: "png",
    fonts,
  } as unknown as Parameters<typeof render>[1]);

  return png instanceof Uint8Array ? png : new Uint8Array(png);
}

async function loadFonts(): Promise<SiteSocialFont[]> {
  if (fontsPromise) return fontsPromise;

  const files: Array<[string, number]> = [
    ["MapleMono-Regular.ttf", 400],
    ["MapleMono-Bold.ttf", 700],
  ];
  fontsPromise = Promise.all(
    files.map(async ([file, weight]): Promise<SiteSocialFont> => {
      const response = await fetch(new URL(`/fonts/maple/${file}`, window.location.origin));
      if (!response.ok) throw new Error(`Could not load ${file}`);

      return {
        name: "Maple Mono",
        data: new Uint8Array(await response.arrayBuffer()),
        weight,
      };
    }),
  ).catch((): SiteSocialFont[] => []);

  return fontsPromise;
}

async function loadIcon(): Promise<string | null> {
  if (iconPromise) return iconPromise;

  iconPromise = (async () => {
    const response = await fetch(new URL("/app-icon.png", window.location.origin));
    if (!response.ok) return null;

    return `data:image/png;base64,${base64(new Uint8Array(await response.arrayBuffer()))}`;
  })().catch(() => null);

  return iconPromise;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }

  return btoa(binary);
}
