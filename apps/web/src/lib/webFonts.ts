import type { WorkspaceStore } from "@typbase/storage";
import type { FontFaceData, FontProperties, FontStyles, ResolveFontOptions } from "unifont";

import { createUnifont, providers } from "unifont";

import { fontFamilyOf, mergeCustomFont } from "./customFonts";

async function createClient(apiBase: string) {
  return createUnifont([providers.google(), providers.fontshare(), providers.fontsource()], {
    apiBase,
  });
}

type WebFontClient = Awaited<ReturnType<typeof createClient>>;

const clients = new Map<string, Promise<WebFontClient>>();
const lists = new Map<string, Promise<string[]>>();
const categories = new Map<string, Promise<Map<string, string>>>();

function clientFor(apiBase: string): Promise<WebFontClient> {
  let client = clients.get(apiBase);
  if (!client) {
    client = createClient(apiBase);
    clients.set(apiBase, client);
    client.catch(() => clients.delete(apiBase));
  }

  return client;
}

/** Every family the configured proxy's providers can resolve. */
export function listWebFonts(apiBase: string): Promise<string[]> {
  let list = lists.get(apiBase);
  if (!list) {
    list = clientFor(apiBase)
      .then(async (client) => {
        const results = await Promise.allSettled(
          (["google", "fontshare", "fontsource"] as const).map((provider) =>
            client.listFonts([provider]),
          ),
        );
        const families = new Set<string>();
        let failure: unknown;
        for (const result of results) {
          if (result.status === "fulfilled") {
            for (const family of result.value ?? []) families.add(family);
          } else {
            failure = result.reason;
          }
        }
        if (!families.size && failure) throw failure;

        return [...families].sort((a, b) => a.localeCompare(b));
      })
      .catch((cause) => {
        lists.delete(apiBase);
        throw cause;
      });
    lists.set(apiBase, list);
  }

  return list;
}

/**
 * Provider categories for the families that publish one. unifont does not
 * carry these, and the selector needs them to separate monospace families
 * whose names do not say "Mono".
 */
export function webFontCategories(apiBase: string): Promise<Map<string, string>> {
  let categoriesForBase = categories.get(apiBase);
  if (!categoriesForBase) {
    categoriesForBase = (async () => {
      const map = new Map<string, string>();
      const [google, fontsource] = await Promise.allSettled([
        fetch(`${apiBase}/google/v1/fonts`).then(async (response) => {
          if (!response.ok) throw new Error(`Google font metadata: ${response.status}`);

          return (await response.json()) as {
            familyMetadataList: Array<{ family: string; category?: string }>;
          };
        }),
        fetch(`${apiBase}/fontsource/v1/fonts`).then(async (response) => {
          if (!response.ok) throw new Error(`Fontsource metadata: ${response.status}`);

          return (await response.json()) as Array<{ family: string; category?: string }>;
        }),
      ]);

      if (google.status === "fulfilled") {
        for (const family of google.value.familyMetadataList) {
          if (family.category) map.set(family.family, family.category);
        }
      }
      if (fontsource.status === "fulfilled") {
        for (const family of fontsource.value) {
          if (family.category) map.set(family.family, family.category);
        }
      }

      return map;
    })();
    categories.set(apiBase, categoriesForBase);
  }

  return categoriesForBase;
}

export function webFontProperties(
  apiBase: string,
  family: string,
): Promise<(FontProperties & { provider?: string }) | undefined> {
  return clientFor(apiBase).then((client) => client.getFontProperties(family));
}

export function resolveWebFont(
  apiBase: string,
  family: string,
  options: Partial<ResolveFontOptions>,
): ReturnType<WebFontClient["resolveFont"]> {
  return clientFor(apiBase).then((client) => client.resolveFont(family, options));
}

function preferredWeights(properties: FontProperties | undefined): string[] {
  const discrete = (properties?.weights ?? []).filter((weight) => !weight.includes(" "));
  const common = ["400", "700"].filter((weight) => discrete.includes(weight));
  if (common.length) return common;

  return [discrete[0] ?? "400"];
}

function preferredSubsets(properties: FontProperties | undefined): string[] {
  const subsets = (properties?.subsets ?? []).filter((subset) => subset !== "menu");

  return subsets.length ? subsets : ["latin"];
}

export interface WebFontInstallResult {
  added: number;
  /** No TTF or OTF face was available. */
  unavailable: boolean;
  failed: number;
}

/**
 * Copies the common upright and italic weights of a hosted family into the
 * workspace. The engine cannot read WOFF, so only TTF and OTF sources are
 * downloaded even though the catalog can preview them.
 */
export async function installWebFontFamily(
  store: WorkspaceStore,
  apiBase: string,
  family: string,
): Promise<WebFontInstallResult> {
  const properties = await webFontProperties(apiBase, family);
  const availableStyles: FontStyles[] = properties?.styles?.filter(
    (style) => style !== "oblique",
  ) ?? ["normal", "italic"];
  const styles: FontStyles[] = availableStyles.length ? availableStyles : ["normal"];
  const resolved = await resolveWebFont(apiBase, family, {
    weights: preferredWeights(properties),
    styles,
    subsets: preferredSubsets(properties),
    formats: ["ttf", "otf"],
  });
  if (!resolved?.fonts.length) return { added: 0, unavailable: true, failed: 0 };

  const sources = new Map<string, RequestInit | undefined>();
  for (const face of resolved.fonts) {
    const source = face.src.find(
      (entry): entry is Extract<FontFaceData["src"][number], { url: string }> =>
        "url" in entry &&
        (entry.format === "truetype" ||
          entry.format === "opentype" ||
          /\.(ttf|otf)(?:[?#]|$)/i.test(entry.url)),
    );
    if (source && !sources.has(source.url)) sources.set(source.url, face.meta?.init);
  }
  if (!sources.size) return { added: 0, unavailable: true, failed: 0 };

  let fonts = store.getSettings().customFonts;
  let added = 0;
  let failed = 0;

  for (const [url, init] of sources) {
    try {
      let response = await fetch(url, init).catch(() => null);
      if (!response && init) response = await fetch(url);
      if (!response?.ok) {
        failed += 1;
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const actualFamily = fontFamilyOf(bytes);
      if (!actualFamily) {
        failed += 1;
        continue;
      }

      const blob = await store.putBlob(bytes);
      fonts = mergeCustomFont(fonts, actualFamily, blob.hash);
      added += 1;
    } catch {
      failed += 1;
    }
  }

  if (fonts !== store.getSettings().customFonts) store.updateSettings({ customFonts: fonts });

  return { added, unavailable: false, failed };
}
