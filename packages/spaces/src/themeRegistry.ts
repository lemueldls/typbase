import type { ThemeFile } from "@typbase/skin";
import type { DidString, RecordOf } from "airspace";

import {
  canonicalJson,
  previewPalette,
  skinHash,
  validateSkin,
  type ContrastWarning,
} from "@typbase/skin";
import { createAirspace, defineCollections, parseAtUri } from "airspace";
import { defineLexicons, field } from "airspace/lexicon";

/**
 * Public theme records. A theme is typed data, so a release is a single record
 * with canonical skin JSON. There is no artifact blob and no preview image.
 */
const themeLexicons = defineLexicons("at.typbase", {
  theme: {
    key: "any",
    name: field.text({ max: 200 }),
    description: field.text({ max: 2000 }).optional(),
    license: field.text({ max: 100 }).optional(),
    homepage: field.url().optional(),
    repository: field.url().optional(),
    tags: field.list(field.text({ max: 40 })).optional(),
    forkedFrom: field.text({ max: 2000 }).optional(),
    latest: field.text({ max: 2000 }),
    createdAt: field.datetime(),
    updatedAt: field.datetime().optional(),
  },
  themeRelease: {
    key: "any",
    theme: field.text({ max: 2000 }),
    version: field.text({ max: 100 }),
    schema: field.text({ max: 100 }),
    data: field.text({ max: 100_000 }),
    sha256: field.text({ max: 128 }),
    size: field.number({ min: 0 }),
    changelog: field.text({ max: 10_000 }).optional(),
    createdAt: field.datetime(),
  },
});

export const themeCollections = defineCollections(themeLexicons);

export type ThemeListing = RecordOf<typeof themeCollections.theme>;
export type ThemeRelease = RecordOf<typeof themeCollections.themeRelease>;

export interface ThemeCatalogEntry {
  /** Listing record URI, the value a user applies from. */
  uri: string;
  publisher: string;
  listing: ThemeListing["value"];
  releaseUri: string | null;
  version: string | null;
  schema: string | null;
  sha256: string | null;
  preview: {
    light: ReturnType<typeof previewPalette>;
    dark: ReturnType<typeof previewPalette>;
  } | null;
  warnings: ContrastWarning[];
  error: string | null;
}

export interface ResolvedPublishedTheme {
  uri: string;
  listing: ThemeListing["value"];
  releaseUri: string;
  release: ThemeRelease["value"];
  theme: ThemeFile;
  warnings: ContrastWarning[];
}

type ThemeClient = ReturnType<typeof createThemeClient>;

const clients = new Map<string, ThemeClient>();
const MAX_THEME_BYTES = 32_000;

function createThemeClient(identity: string, service?: string) {
  return createAirspace({
    identity: service ? { did: identity as DidString, service } : (identity as DidString),
    collections: {
      theme: themeCollections.theme,
      themeRelease: themeCollections.themeRelease,
    },
  });
}

function clientFor(identity: string, service?: string): ThemeClient {
  const key = `${identity}\n${service ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = createThemeClient(identity, service);
    clients.set(key, client);
  }

  return client;
}

function releaseClient(uri: string, service?: string): { client: ThemeClient; rkey: string } {
  const ref = parseAtUri(uri);
  if (ref.collection !== "at.typbase.themeRelease" || !ref.rkey) {
    throw new Error(`Not a theme release URI: ${uri}`);
  }

  return { client: clientFor(ref.authority, service), rkey: ref.rkey };
}

async function readRelease(
  uri: string,
  service?: string,
): Promise<{ uri: string; value: ThemeRelease["value"] }> {
  const { client, rkey } = releaseClient(uri, service);
  const record = await client.themeRelease.get(rkey);
  if (!record) throw new Error(`Theme release not found: ${uri}`);

  return { uri, value: record.value };
}

/** Derive a stable listing rkey from a display name. */
export function themeSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "theme";
}

function parseTheme(
  listing: ThemeListing["value"],
  release: ThemeRelease["value"],
): { theme: ThemeFile; warnings: ContrastWarning[] } {
  const actualSize = new TextEncoder().encode(release.data).byteLength;
  if (release.size !== actualSize) {
    throw new Error("theme release size does not match its data");
  }
  if (actualSize > MAX_THEME_BYTES) {
    throw new Error(`theme data is ${actualSize} bytes, over ${MAX_THEME_BYTES}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(release.data);
  } catch {
    throw new Error("theme release data is not JSON");
  }

  const result = validateSkin(raw);
  if (!result.ok || !result.value) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }
  if (release.schema !== result.value.schema) {
    throw new Error("theme release schema does not match the skin schema");
  }

  return {
    theme: {
      schema: "typbase.theme.v1",
      name: listing.name,
      ...(listing.description ? { description: listing.description } : {}),
      ...(listing.license ? { license: listing.license } : {}),
      ...(listing.tags ? { tags: [...listing.tags] } : {}),
      ...(listing.forkedFrom ? { forkedFrom: listing.forkedFrom } : {}),
      skin: result.value,
    },
    warnings: result.warnings,
  };
}

function previews(theme: ThemeFile): ThemeCatalogEntry["preview"] {
  return {
    light: previewPalette(theme.skin.palette.light, "light"),
    dark: previewPalette(theme.skin.palette.dark, "dark"),
  };
}

/** Every theme a publisher lists, with its latest release metadata. */
export async function listPublisherThemes(
  publisher: string,
  service?: string,
): Promise<ThemeCatalogEntry[]> {
  const client = clientFor(publisher, service);
  const records = await client.theme.list();
  const entries: ThemeCatalogEntry[] = [];

  for (const record of records) {
    const listing = record.value;
    let releaseUri: string | null = null;
    let version: string | null = null;
    let schema: string | null = null;
    let sha256: string | null = null;
    let preview: ThemeCatalogEntry["preview"] = null;
    let warnings: ContrastWarning[] = [];
    let error: string | null = null;

    if (listing.latest) {
      try {
        const release = await readRelease(listing.latest, service);
        if (release.value.theme !== record.uri) {
          throw new Error("latest release points at a different listing");
        }
        const parsed = parseTheme(listing, release.value);
        const hash = await skinHash(parsed.theme.skin);
        if (hash !== release.value.sha256) {
          throw new Error("theme checksum does not match its release record");
        }
        releaseUri = release.uri;
        version = release.value.version;
        schema = release.value.schema;
        sha256 = release.value.sha256;
        preview = previews(parsed.theme);
        warnings = parsed.warnings;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } else {
      error = "theme has no release";
    }

    entries.push({
      uri: record.uri,
      publisher: record.author ?? publisher,
      listing,
      releaseUri,
      version,
      schema,
      sha256,
      preview,
      warnings,
      error,
    });
  }

  return entries;
}

/**
 * Resolves a theme listing and its latest release from the publisher's PDS.
 * No catalog is involved. The caller applies the returned theme after checking
 * the schema version.
 */
export async function resolvePublishedTheme(
  uri: string,
  options: { service?: string } = {},
): Promise<ResolvedPublishedTheme> {
  const ref = parseAtUri(uri);
  if (ref.collection !== "at.typbase.theme" || !ref.rkey) {
    throw new Error(`Not a theme listing URI: ${uri}`);
  }

  const client = clientFor(ref.authority, options.service);
  const listing = await client.theme.get(ref.rkey);
  if (!listing) throw new Error(`Theme not found: ${uri}`);
  if (!listing.value.latest) throw new Error(`Theme has no release: ${uri}`);

  const release = await readRelease(listing.value.latest, options.service);
  if (release.value.theme !== uri) {
    throw new Error(`Theme release ${release.uri} points at a different listing`);
  }

  const parsed = parseTheme(listing.value, release.value);
  const hash = await skinHash(parsed.theme.skin);
  if (hash !== release.value.sha256) {
    throw new Error("theme checksum does not match its release record");
  }

  return {
    uri,
    listing: listing.value,
    releaseUri: release.uri,
    release: release.value,
    theme: parsed.theme,
    warnings: parsed.warnings,
  };
}

export interface PublishedTheme {
  listingUri: string;
  releaseUri: string;
  version: string;
  sha256: string;
}

/** OAuth and password sessions both satisfy airspace's write session. */
export type RecordSession = NonNullable<Parameters<typeof createAirspace>[0]["session"]>;

/**
 * Publishes one immutable release and points the listing at it. The data is
 * canonical JSON, so the same skin hashes the same everywhere.
 */
export async function publishTheme(
  session: RecordSession,
  did: string,
  input: {
    slug: string;
    version: string;
    theme: ThemeFile;
    changelog?: string;
    service?: string;
  },
): Promise<PublishedTheme> {
  const listingUri = `at://${did}/at.typbase.theme/${input.slug}`;
  const result = validateSkin(input.theme.skin);
  if (!result.ok || !result.value) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  const data = canonicalJson(result.value);
  const size = new TextEncoder().encode(data).byteLength;
  if (size > MAX_THEME_BYTES)
    throw new Error(`theme data is ${size} bytes, over ${MAX_THEME_BYTES}`);
  const hash = await skinHash(result.value);
  if (!/^\d+\.\d+\.\d+/.test(input.version)) {
    throw new Error(`theme version "${input.version}" is not semver`);
  }

  const client = createAirspace({
    identity: input.service
      ? { did: did as DidString, service: input.service }
      : (did as DidString),
    collections: {
      theme: themeCollections.theme,
      themeRelease: themeCollections.themeRelease,
    },
    session,
  });
  const createdAt = new Date().toISOString();
  const releaseKey = `${input.version}-${hash.slice(0, 8)}`.replace(/[^A-Za-z0-9._~:-]+/g, "-");
  const release = await client.themeRelease.put(releaseKey, {
    theme: listingUri,
    version: input.version,
    schema: result.value.schema,
    data,
    sha256: hash,
    size,
    ...(input.changelog ? { changelog: input.changelog } : {}),
    createdAt,
  });
  const existing = await client.theme.get(input.slug);
  const listing = {
    name: input.theme.name,
    ...(input.theme.description ? { description: input.theme.description } : {}),
    ...(input.theme.license ? { license: input.theme.license } : {}),
    ...(input.theme.forkedFrom ? { forkedFrom: input.theme.forkedFrom } : {}),
    ...(input.theme.tags ? { tags: input.theme.tags } : {}),
    latest: release.uri,
    createdAt: existing?.value.createdAt ?? createdAt,
    updatedAt: createdAt,
  };
  await client.theme.put(input.slug, listing);

  return { listingUri, releaseUri: release.uri, version: input.version, sha256: hash };
}

/** Deletes the listing. Releases stay as history and stop being listed. */
export async function unpublishTheme(
  session: RecordSession,
  did: string,
  slug: string,
  options: { service?: string } = {},
): Promise<void> {
  const client = createAirspace({
    identity: options.service
      ? { did: did as DidString, service: options.service }
      : (did as DidString),
    collections: { theme: themeCollections.theme },
    session,
  });
  await client.theme.delete(slug);
}

/** A helper for registry pages that have a release URI but not the listing. */
export async function getThemeRelease(uri: string): Promise<ThemeRelease["value"] | null> {
  try {
    return (await readRelease(uri)).value;
  } catch {
    return null;
  }
}
