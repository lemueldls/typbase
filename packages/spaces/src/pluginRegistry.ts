import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { PluginManifest } from "@typbase/typing";
import type { DidString, RecordOf } from "airspace";

import { createAirspace, defineCollections, parseAtUri } from "airspace";
import { defineLexicons, field } from "airspace/lexicon";

/**
 * Public plugin records. Unlike workspace data these live in the publisher's
 * public repo, so any catalog can index them and the app can install from a
 * DID or AT URI without trusting the catalog.
 */
const pluginLexicons = defineLexicons("at.typbase", {
  plugin: {
    key: "any",
    name: field.text({ max: 200 }),
    description: field.text({ max: 2000 }).optional(),
    icon: field.text({ max: 100 }).optional(),
    license: field.text({ max: 100 }).optional(),
    homepage: field.url().optional(),
    repository: field.url().optional(),
    tags: field.list(field.text({ max: 40 })).optional(),
    latest: field.text({ max: 2000 }),
    createdAt: field.datetime(),
  },
  pluginRelease: {
    key: "any",
    plugin: field.text({ max: 2000 }),
    version: field.text({ max: 100 }),
    api: field.text({ max: 100 }),
    minHost: field.text({ max: 100 }).optional(),
    manifest: field.text({ max: 100_000 }),
    artifact: field.blob({ accept: ["application/json"] }),
    sha256: field.text({ max: 128 }),
    size: field.number({ min: 0 }),
    capabilities: field.list(field.text({ max: 64 })),
    changelog: field.text({ max: 10_000 }).optional(),
    createdAt: field.datetime(),
  },
});

export const pluginCollections = defineCollections(pluginLexicons);

export type PluginListing = RecordOf<typeof pluginCollections.plugin>;
export type PluginRelease = RecordOf<typeof pluginCollections.pluginRelease>;

export interface PluginCatalogEntry {
  /** Listing record URI, the value a user installs from. */
  uri: string;
  publisher: string;
  listing: PluginListing["value"];
  releaseUri: string | null;
  version: string | null;
  api: string | null;
  capabilities: string[];
  manifest: unknown;
  sha256: string | null;
}

export interface ResolvedPlugin {
  uri: string;
  listing: PluginListing["value"];
  releaseUri: string;
  release: PluginRelease["value"];
  /** Parsed manifest JSON. The app still runs its full manifest validator. */
  manifest: unknown;
  artifact: Uint8Array;
}

type PluginClient = ReturnType<typeof createPluginClient>;

const clients = new Map<string, PluginClient>();

function createPluginClient(identity: string, service?: string) {
  return createAirspace({
    identity: service ? { did: identity as DidString, service } : (identity as DidString),
    collections: {
      plugin: pluginCollections.plugin,
      pluginRelease: pluginCollections.pluginRelease,
    },
  });
}

function clientFor(identity: string, service?: string): PluginClient {
  const key = `${identity}\n${service ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = createPluginClient(identity, service);
    clients.set(key, client);
  }

  return client;
}

function releaseClient(uri: string, service?: string): { client: PluginClient; rkey: string } {
  const ref = parseAtUri(uri);
  if (ref.collection !== "at.typbase.pluginRelease" || !ref.rkey) {
    throw new Error(`Not a plugin release URI: ${uri}`);
  }

  return { client: clientFor(ref.authority, service), rkey: ref.rkey };
}

async function readRelease(
  uri: string,
  service?: string,
): Promise<{ uri: string; value: PluginRelease["value"] }> {
  const { client, rkey } = releaseClient(uri, service);
  const record = await client.pluginRelease.get(rkey);
  if (!record) throw new Error(`Plugin release not found: ${uri}`);

  return { uri, value: record.value };
}

function parseManifest(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("plugin release contains invalid manifest JSON");
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Every plugin a publisher lists, with its latest release metadata. */
export async function listPublisherPlugins(
  publisher: string,
  service?: string,
): Promise<PluginCatalogEntry[]> {
  const client = clientFor(publisher, service);
  const records = await client.plugin.list();
  const entries: PluginCatalogEntry[] = [];

  for (const record of records) {
    const listing = record.value;
    let releaseUri: string | null = null;
    let version: string | null = null;
    let api: string | null = null;
    let capabilities: string[] = [];
    let manifest: unknown = null;
    let sha256: string | null = null;

    if (listing.latest) {
      try {
        const release = await readRelease(listing.latest, service);
        if (release.value.plugin === record.uri) {
          releaseUri = release.uri;
          version = release.value.version;
          api = release.value.api;
          capabilities = [...release.value.capabilities];
          manifest = parseManifest(release.value.manifest);
          sha256 = release.value.sha256;
        }
      } catch {
        // A listing whose latest release is missing still shows in the
        // catalog as unavailable; the app cannot install it until fixed.
      }
    }

    entries.push({
      uri: record.uri,
      publisher: record.author ?? publisher,
      listing,
      releaseUri,
      version,
      api,
      capabilities,
      manifest,
      sha256,
    });
  }

  return entries;
}

/**
 * Resolves a plugin listing and its latest release from the publisher's PDS,
 * then downloads and verifies the artifact. No catalog is involved. The
 * caller validates the manifest against the host API before installing it.
 */
export async function resolvePlugin(
  uri: string,
  options: { service?: string } = {},
): Promise<ResolvedPlugin> {
  const ref = parseAtUri(uri);
  if (ref.collection !== "at.typbase.plugin" || !ref.rkey) {
    throw new Error(`Not a plugin listing URI: ${uri}`);
  }

  const client = clientFor(ref.authority, options.service);
  const listing = await client.plugin.get(ref.rkey);
  if (!listing) throw new Error(`Plugin not found: ${uri}`);
  if (!listing.value.latest) throw new Error(`Plugin has no release: ${uri}`);

  const release = await readRelease(listing.value.latest, options.service);
  if (release.value.plugin !== uri) {
    throw new Error(`Plugin release ${release.uri} points at a different listing`);
  }

  const artifactUrl = await client.blobs.url(release.value.artifact);
  if (!artifactUrl) throw new Error(`Plugin release ${release.uri} has no artifact`);
  const response = await fetch(artifactUrl);
  if (!response.ok) {
    throw new Error(`Plugin artifact download failed (${response.status})`);
  }
  const artifact = new Uint8Array(await response.arrayBuffer());
  const hash = await sha256Hex(artifact);
  if (artifact.byteLength !== release.value.size) {
    throw new Error("plugin artifact size does not match its release record");
  }
  if (hash !== release.value.sha256) {
    throw new Error("plugin artifact checksum does not match its release record");
  }

  return {
    uri,
    listing: listing.value,
    releaseUri: release.uri,
    release: release.value,
    manifest: parseManifest(release.value.manifest),
    artifact,
  };
}

/** The result of publishing one immutable release to the publisher's PDS. */
export interface PublishedPlugin {
  listingUri: string;
  releaseUri: string;
  version: string;
}

/**
 * Publishes a plugin listing and release to the signed-in account's public
 * repo. The artifact is already built, and its manifest must carry the listing
 * URI as its id.
 */
export async function publishPlugin(
  session: OAuthSession,
  did: string,
  input: {
    slug: string;
    manifest: PluginManifest;
    artifact: Uint8Array;
    changelog?: string;
    minHost?: string;
    service?: string;
  },
): Promise<PublishedPlugin> {
  const listingUri = `at://${did}/at.typbase.plugin/${input.slug}`;
  if (input.manifest.id !== listingUri) {
    throw new Error(`plugin manifest id must be ${listingUri}`);
  }

  const client = createAirspace({
    identity: input.service
      ? { did: did as DidString, service: input.service }
      : { did: did as DidString },
    collections: {
      plugin: pluginCollections.plugin,
      pluginRelease: pluginCollections.pluginRelease,
    },
    session,
  });
  const uploaded = await client.blobs.upload(input.artifact, { mimeType: "application/json" });
  const hash = await sha256Hex(input.artifact);
  const createdAt = new Date().toISOString();
  const releaseKey = `${input.manifest.version}-${hash.slice(0, 8)}`.replace(
    /[^A-Za-z0-9._~:-]+/g,
    "-",
  );
  const release = await client.pluginRelease.put(releaseKey, {
    plugin: listingUri,
    version: input.manifest.version,
    api: input.manifest.api,
    ...(input.minHost ? { minHost: input.minHost } : {}),
    manifest: JSON.stringify(input.manifest),
    artifact: uploaded.blob,
    sha256: hash,
    size: input.artifact.byteLength,
    capabilities: input.manifest.capabilities,
    ...(input.changelog ? { changelog: input.changelog } : {}),
    createdAt,
  });
  const existing = await client.plugin.get(input.slug);
  const listing = {
    name: input.manifest.name,
    ...(input.manifest.description ? { description: input.manifest.description } : {}),
    ...(input.manifest.icon ? { icon: input.manifest.icon } : {}),
    latest: release.uri,
    createdAt: existing?.value.createdAt ?? createdAt,
  };
  await client.plugin.put(input.slug, listing);

  return { listingUri, releaseUri: release.uri, version: input.manifest.version };
}

/** A helper for registry pages that have a release URI but not the listing. */
export async function getPluginRelease(uri: string): Promise<PluginRelease["value"] | null> {
  try {
    return (await readRelease(uri)).value;
  } catch {
    return null;
  }
}
