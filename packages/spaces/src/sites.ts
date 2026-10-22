/** A file the site publisher hands to the host. */
export interface WispFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface WispPublishOptions {
  siteRkey: string;
  files: WispFile[];
  /** Previous SHA-256 per path, so unchanged blobs are not uploaded again. */
  fileHashes?: Record<string, string>;
  settings?: WispSiteSettingsRecord;
}

export interface WispPublishResult {
  uri: string;
  cid: string | null;
  siteRkey: string;
  fileCount: number;
  totalBytes: number;
  hashes: Record<string, string>;
  reused: number;
  uploaded: number;
}

export interface WispSiteSettingsRecord {
  cleanUrls?: boolean;
  custom404?: string;
  indexFiles?: string[];
  headers?: Array<{ name: string; value: string; path?: string }>;
}

export interface WispDomainStatus {
  domain: string;
  status: "unclaimed" | "pendingVerification" | "verified" | "alreadyClaimed";
  kind?: "wisp" | "custom";
  verified?: boolean;
  siteRkey?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface WispDomainClaim {
  domain: string;
  kind: "wisp" | "custom";
  status: "verified" | "pendingVerification" | "alreadyClaimed";
  siteRkey?: string;
  challengeId?: string;
  txtName?: string;
  txtValue?: string;
  cnameTarget?: string;
}

export interface StandardPublicationInput {
  url: string;
  name: string;
  description: string;
  showInDiscover: boolean;
  palette: Record<string, string>;
}

export interface StandardDocumentInput {
  pageId: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  textContent: string;
  publishedAt: string;
  updatedAt: string;
}

export interface StandardPublishResult {
  publicationUri: string;
  publicationRkey: string;
  documentRkeys: Record<string, string>;
}

export interface PublicRepo {
  readonly did: string;
  getRecord(collection: string, rkey: string): Promise<RecordResult | null>;
  putRecord(
    collection: string,
    rkey: string,
    value: Record<string, unknown>,
  ): Promise<{ uri: string; cid: string | null }>;
  deleteRecord(collection: string, rkey: string): Promise<void>;
  uploadBlob(bytes: Uint8Array, mimeType?: string): Promise<Record<string, unknown>>;
  serviceAuth(nsid: string, audience: string): Promise<string>;
}

interface RecordResult {
  uri: string;
  cid: string | null;
  value: Record<string, unknown>;
}

/** The session shape both the browser OAuth client and airspace's password session expose. */
export interface PublicSession {
  readonly did: string;
  fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
}

/** A public repo view over one session, without airspace's space model. */
export function createPublicRepo(session: PublicSession, did: string = session.did): PublicRepo {
  async function call(method: string, init: RequestInit = {}): Promise<Response> {
    return session.fetchHandler(`/xrpc/${method}`, init);
  }

  async function fail(response: Response, method: string): Promise<never> {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    throw new Error(
      `${method} failed (${response.status}): ${body?.message ?? body?.error ?? response.statusText}`,
    );
  }

  return {
    did,
    async getRecord(collection, rkey) {
      const params = new URLSearchParams({ repo: did, collection, rkey });
      const response = await call(`com.atproto.repo.getRecord?${params.toString()}`);
      if (response.status === 400 || response.status === 404) return null;
      if (!response.ok) await fail(response, "com.atproto.repo.getRecord");
      const body = (await response.json()) as RecordResult;

      return body;
    },
    async putRecord(collection, rkey, value) {
      const response = await call("com.atproto.repo.putRecord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: did, collection, rkey, record: value }),
      });
      if (!response.ok) await fail(response, "com.atproto.repo.putRecord");
      const body = (await response.json()) as { uri: string; cid?: string };

      return { uri: body.uri, cid: body.cid ?? null };
    },
    async deleteRecord(collection, rkey) {
      const response = await call("com.atproto.repo.deleteRecord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: did, collection, rkey }),
      });
      if (response.status === 400 || response.status === 404) return;
      if (!response.ok) await fail(response, "com.atproto.repo.deleteRecord");
    },
    async uploadBlob(bytes, mimeType = "application/octet-stream") {
      const response = await call("com.atproto.repo.uploadBlob", {
        method: "POST",
        headers: { "content-type": mimeType },
        body: bytes as BodyInit,
      });
      if (!response.ok) await fail(response, "com.atproto.repo.uploadBlob");
      const body = (await response.json()) as { blob: Record<string, unknown> };

      return body.blob;
    },
    async serviceAuth(nsid, audience) {
      const params = new URLSearchParams({ aud: audience, lxm: nsid });
      const response = await call(`com.atproto.server.getServiceAuth?${params.toString()}`);
      if (!response.ok) await fail(response, "com.atproto.server.getServiceAuth");
      const body = (await response.json()) as { token: string };

      return body.token;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Wisp                                                                        */
/* -------------------------------------------------------------------------- */

const WISP_FS = "place.wisp.fs";
const WISP_SUBFS = "place.wisp.subfs";
const WISP_SETTINGS = "place.wisp.settings";
const MAX_FILES = 1000;
const MAX_SITE_BYTES = 300 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 140 * 1024;
const MAX_SUBFS_SIZE = 75 * 1024;
const FILE_COUNT_THRESHOLD = 250;
const TARGET_FILES = 200;

interface WispTreeFile {
  kind: "file";
  name: string;
  blob: Record<string, unknown>;
  mimeType: string;
  encoding?: string;
  base64?: boolean;
}

interface WispTreeDirectory {
  kind: "directory";
  name: string;
  entries: WispTreeEntry[];
}

interface WispTreeSubfs {
  kind: "subfs";
  name: string;
  subject: string;
  flat: boolean;
}

type WispTreeEntry = WispTreeFile | WispTreeDirectory | WispTreeSubfs;

/**
 * Writes one site to Wisp: upload the changed blobs, make the manifest
 * (splitting it when it grows past Wisp's record limits), then write the
 * settings and manifest records. The manifest goes last so a failed upload
 * leaves the previous site in place.
 */
export async function publishWispSite(
  repo: PublicRepo,
  options: WispPublishOptions,
): Promise<WispPublishResult> {
  if (options.files.length > MAX_FILES) {
    throw new Error(
      `This site has ${options.files.length} files. Wisp accepts at most ${MAX_FILES}.`,
    );
  }
  const totalBytes = options.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (totalBytes > MAX_SITE_BYTES) {
    throw new Error("This site is larger than Wisp's 300 MB per-site limit.");
  }

  const existing = await readWispSite(repo, repo.did, options.siteRkey);
  const hashes: Record<string, string> = {};
  const uploaded: Array<{
    file: WispFile;
    blob: Record<string, unknown>;
    encoding?: string;
    base64?: boolean;
  }> = [];
  let reused = 0;
  let uploadedCount = 0;

  for (const file of options.files) {
    const hash = await sha256Hex(file.bytes);
    hashes[file.name] = hash;
    const previous = existing.files.get(file.name);
    if (previous && options.fileHashes?.[file.name] === hash) {
      uploaded.push({
        file,
        blob: previous.blob,
        encoding: previous.encoding,
        base64: previous.base64,
      });
      reused++;
      continue;
    }

    const blob = await repo.uploadBlob(file.bytes);
    uploaded.push({ file, blob });
    uploadedCount++;
  }

  const root = wispTree(uploaded);
  const createdAt = new Date().toISOString();
  const generation = nextTid();
  const plan = splitWispTree(root, repo.did, options.siteRkey, generation);
  const written = new Set<string>();

  for (const record of plan.records) {
    await repo.putRecord(WISP_SUBFS, record.rkey, record.record);
    written.add(record.rkey);
  }

  if (options.settings) {
    await repo.putRecord(WISP_SETTINGS, options.siteRkey, {
      $type: WISP_SETTINGS,
      cleanUrls: options.settings.cleanUrls ?? true,
      custom404: options.settings.custom404,
      indexFiles: options.settings.indexFiles ?? ["index.html"],
      ...(options.settings.headers?.length ? { headers: options.settings.headers } : {}),
    });
  }

  const manifest = {
    $type: WISP_FS,
    site: options.siteRkey,
    root: directoryRecord(plan.directory, "place.wisp.fs#directory"),
    fileCount: countFiles(root),
    createdAt,
  };
  const result = await repo.putRecord(WISP_FS, options.siteRkey, manifest);

  const stale = [...existing.subfs].filter((rkey) => !written.has(rkey));
  for (const rkey of stale) {
    await repo.deleteRecord(WISP_SUBFS, rkey).catch(() => undefined);
  }

  return {
    uri: result.uri,
    cid: result.cid,
    siteRkey: options.siteRkey,
    fileCount: options.files.length,
    totalBytes,
    hashes,
    reused,
    uploaded: uploadedCount,
  };
}

/** The shared-path URL Wisp always exposes, independent of a custom domain. */
export function wispSiteUrl(
  did: string,
  siteRkey: string,
  serviceUrl = "https://wisp.place",
): string {
  let host = "wisp.place";
  let protocol = "https:";
  try {
    const url = new URL(serviceUrl);
    host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    protocol = url.protocol === "http:" ? "http:" : "https:";
  } catch {
    // Keep the public host for a malformed service URL; the publish call will
    // fail against it with a clearer error.
  }
  const siteHost = host === "wisp.place" ? "sites.wisp.place" : `sites.${host}`;

  return `${protocol}//${siteHost}/${did}/${siteRkey}`;
}

/** Deletes the site records Wisp can reconstruct from. Best effort per record. */
export async function deleteWispSite(repo: PublicRepo, siteRkey: string): Promise<void> {
  const existing = await readWispSite(repo, repo.did, siteRkey);
  await repo.deleteRecord(WISP_FS, siteRkey).catch(() => undefined);
  await repo.deleteRecord(WISP_SETTINGS, siteRkey).catch(() => undefined);
  for (const rkey of existing.subfs) {
    await repo.deleteRecord(WISP_SUBFS, rkey).catch(() => undefined);
  }
}

function wispTree(
  uploaded: Array<{
    file: WispFile;
    blob: Record<string, unknown>;
    encoding?: string;
    base64?: boolean;
  }>,
): WispTreeDirectory {
  const root: WispTreeDirectory = { kind: "directory", name: "", entries: [] };
  for (const { file, blob, encoding, base64 } of uploaded) {
    const parts = file.name.split("/").filter(Boolean);
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      let child = directory.entries.find(
        (entry): entry is WispTreeDirectory => entry.kind === "directory" && entry.name === part,
      );
      if (!child) {
        child = { kind: "directory", name: part, entries: [] };
        directory.entries.push(child);
      }
      directory = child;
    }
    const name = parts.at(-1);
    if (!name) continue;
    directory.entries.push({
      kind: "file",
      name,
      blob,
      mimeType: file.mimeType,
      encoding,
      base64,
    });
  }

  sortDirectory(root);

  return root;
}

function sortDirectory(directory: WispTreeDirectory): void {
  directory.entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of directory.entries) {
    if (entry.kind === "directory") sortDirectory(entry);
  }
}

interface WispSplitRecord {
  rkey: string;
  record: Record<string, unknown>;
}

interface WispSplitPlan {
  directory: WispTreeDirectory;
  records: WispSplitRecord[];
}

/**
 * Wisp splits large manifests into `place.wisp.subfs` records. The planner
 * replaces oversized directories with flat subfs references. Each chunk stays
 * under the same 200-file, 75 KB budget the reference CLI uses.
 */
function splitWispTree(
  root: WispTreeDirectory,
  did: string,
  siteRkey: string,
  generation: string,
): WispSplitPlan {
  const records: WispSplitRecord[] = [];
  let counter = 0;

  function newRecord(directory: WispTreeDirectory): WispTreeSubfs {
    const rkey = `${siteRkey}-${generation}-subfs-${++counter}`;
    records.push({
      rkey,
      record: {
        $type: WISP_SUBFS,
        root: directoryRecord(directory, "place.wisp.subfs#directory"),
        fileCount: countFiles(directory),
        createdAt: new Date().toISOString(),
      },
    });

    return {
      kind: "subfs",
      name: `chunk-${counter}`,
      subject: `at://${did}/${WISP_SUBFS}/${rkey}`,
      flat: true,
    };
  }

  function split(directory: WispTreeDirectory): WispTreeDirectory {
    const next: WispTreeDirectory = { kind: "directory", name: directory.name, entries: [] };
    for (const entry of directory.entries) {
      if (entry.kind === "directory") {
        const child = split(entry);
        next.entries.push(child);
      } else {
        next.entries.push(entry);
      }
    }

    if (fits(next)) return next;

    const chunks = chunkEntries(next.entries);
    return {
      kind: "directory",
      name: directory.name,
      entries: chunks.map((chunk) => newRecord({ kind: "directory", name: "", entries: chunk })),
    };
  }

  const planRoot = split(root);
  const manifestSize = jsonSize({
    $type: WISP_FS,
    site: siteRkey,
    root: directoryRecord(planRoot, "place.wisp.fs#directory"),
    fileCount: countFiles(root),
    createdAt: new Date().toISOString(),
  });

  if (
    countFiles(root) < FILE_COUNT_THRESHOLD &&
    manifestSize <= MAX_MANIFEST_SIZE &&
    records.length === 0
  ) {
    return { directory: planRoot, records: [] };
  }

  return { directory: planRoot, records };
}

function fits(directory: WispTreeDirectory): boolean {
  const files = countFiles(directory);
  const size = jsonSize(directoryRecord(directory, "place.wisp.subfs#directory"));

  return files <= TARGET_FILES && size <= MAX_SUBFS_SIZE && directory.entries.length <= 500;
}

function chunkEntries(entries: WispTreeEntry[]): WispTreeEntry[][] {
  const chunks: WispTreeEntry[][] = [];
  let current: WispTreeEntry[] = [];
  let files = 0;
  let size = 0;

  const flush = (): void => {
    if (current.length) chunks.push(current);
    current = [];
    files = 0;
    size = 0;
  };

  for (const entry of entries) {
    const entryFiles =
      entry.kind === "file" ? 1 : entry.kind === "directory" ? countFiles(entry) : 0;
    const entrySize = jsonSize(entryRecord(entry));
    if (current.length && files + entryFiles > TARGET_FILES) flush();
    if (current.length && size + entrySize > MAX_SUBFS_SIZE) flush();
    current.push(entry);
    files += entryFiles;
    size += entrySize;
  }
  flush();

  return chunks;
}

function directoryRecord(
  directory: WispTreeDirectory,
  type: "place.wisp.fs#directory" | "place.wisp.subfs#directory",
): Record<string, unknown> {
  return {
    $type: type,
    type: "directory",
    entries: directory.entries.map(entryRecord),
  };
}

function entryRecord(entry: WispTreeEntry): Record<string, unknown> {
  if (entry.kind === "file") {
    return {
      name: entry.name,
      node: {
        type: "file",
        blob: entry.blob,
        mimeType: entry.mimeType,
        ...(entry.encoding ? { encoding: entry.encoding } : {}),
        ...(entry.base64 ? { base64: true } : {}),
      },
    };
  }
  if (entry.kind === "subfs") {
    return {
      name: entry.name,
      node: { type: "subfs", subject: entry.subject, flat: entry.flat },
    };
  }

  return {
    name: entry.name,
    node: {
      type: "directory",
      entries: entry.entries.map(entryRecord),
    },
  };
}

function countFiles(entry: WispTreeEntry | WispTreeDirectory): number {
  if (entry.kind === "file") return 1;
  if (entry.kind === "subfs") return 0;

  return entry.entries.reduce((sum, child) => sum + countFiles(child), 0);
}

function jsonSize(value: unknown): number {
  return JSON.stringify(value).length;
}

async function readWispSite(
  repo: PublicRepo,
  did: string,
  siteRkey: string,
): Promise<{
  files: Map<string, { blob: Record<string, unknown>; encoding?: string; base64?: boolean }>;
  subfs: Set<string>;
}> {
  const files = new Map<
    string,
    { blob: Record<string, unknown>; encoding?: string; base64?: boolean }
  >();
  const subfs = new Set<string>();
  const manifest = await repo.getRecord(WISP_FS, siteRkey);
  if (!manifest) return { files, subfs };

  async function walk(root: Record<string, unknown>, prefix: string): Promise<void> {
    const entries = Array.isArray(root.entries)
      ? (root.entries as Array<Record<string, unknown>>)
      : [];
    for (const entry of entries) {
      const name = String(entry.name ?? "");
      const node = entry.node as Record<string, unknown> | undefined;
      if (!node) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (node.type === "file" && node.blob) {
        files.set(path, {
          blob: node.blob as Record<string, unknown>,
          encoding: typeof node.encoding === "string" ? node.encoding : undefined,
          base64: node.base64 === true,
        });
      } else if (node.type === "directory") {
        await walk(node, path);
      } else if (node.type === "subfs" && typeof node.subject === "string") {
        const rkey = node.subject.split("/").pop() ?? "";
        if (!rkey) continue;
        subfs.add(rkey);
        const record = await repo.getRecord(WISP_SUBFS, rkey);
        if (record) {
          const child = record.value.root as Record<string, unknown> | undefined;
          if (child) await walk(child, node.flat === false ? path : prefix);
        }
      }
    }
  }

  const root = manifest.value.root;
  if (root && typeof root === "object") {
    await walk(root as Record<string, unknown>, "");
  }

  return { files, subfs };
}

/* -------------------------------------------------------------------------- */
/* Wisp domains                                                               */
/* -------------------------------------------------------------------------- */

export function createWispDomains(repo: PublicRepo, serviceUrl: string, serviceDid: string) {
  const base = serviceUrl.replace(/\/+$/, "");

  async function call<T>(nsid: string, input: Record<string, unknown>): Promise<T> {
    const token = await repo.serviceAuth(nsid, serviceDid);
    const response = await fetch(`${base}/xrpc/${nsid}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as
      | (T & { message?: string; error?: string })
      | null;
    if (!response.ok) {
      throw new Error(
        `${nsid} failed (${response.status}): ${body?.message ?? body?.error ?? response.statusText}`,
      );
    }

    return body as T;
  }

  return {
    async status(domain: string): Promise<WispDomainStatus> {
      const response = await fetch(
        `${base}/xrpc/place.wisp.v2.domain.getStatus?domain=${encodeURIComponent(domain)}`,
      );
      if (!response.ok) throw new Error(`Domain status failed (${response.status})`);

      return (await response.json()) as WispDomainStatus;
    },
    claimSubdomain(handle: string, siteRkey: string): Promise<WispDomainClaim> {
      return call("place.wisp.v2.domain.claimSubdomain", { handle, siteRkey });
    },
    claimCustom(domain: string, siteRkey: string): Promise<WispDomainClaim> {
      return call("place.wisp.v2.domain.claim", { domain, siteRkey });
    },
    addSite(domain: string, siteRkey: string): Promise<WispDomainClaim> {
      return call("place.wisp.v2.domain.addSite", { domain, siteRkey });
    },
    deleteDomain(domain: string): Promise<{ deleted: boolean }> {
      return call("place.wisp.v2.domain.delete", { domain });
    },
    deleteSite(siteRkey: string): Promise<{ deleted: boolean }> {
      return call("place.wisp.v2.site.delete", { siteRkey });
    },
    async list(): Promise<Array<WispDomainStatus & { siteRkey?: string }>> {
      const token = await repo.serviceAuth("place.wisp.v2.domain.getList", serviceDid);
      const response = await fetch(`${base}/xrpc/place.wisp.v2.domain.getList`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Domain list failed (${response.status})`);
      const body = (await response.json()) as { domains?: Array<WispDomainStatus> };

      return body.domains ?? [];
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Standard.site                                                              */
/* -------------------------------------------------------------------------- */

const STANDARD_PUBLICATION = "site.standard.publication";
const STANDARD_DOCUMENT = "site.standard.document";

export async function publishStandardSite(
  repo: PublicRepo,
  input: {
    publication: StandardPublicationInput;
    documents: StandardDocumentInput[];
    publicationRkey: string | null;
    publicationUri: string | null;
    documentRkeys: Record<string, string>;
  },
): Promise<StandardPublishResult> {
  const publicationRkey =
    input.publicationRkey ?? input.publicationUri?.split("/").filter(Boolean).pop() ?? nextTid();
  const publicationUri =
    input.publicationUri ?? `at://${repo.did}/${STANDARD_PUBLICATION}/${publicationRkey}`;
  const documentRkeys = { ...input.documentRkeys };

  await repo.putRecord(STANDARD_PUBLICATION, publicationRkey, {
    $type: STANDARD_PUBLICATION,
    url: input.publication.url.replace(/\/+$/, ""),
    name: input.publication.name,
    ...(input.publication.description ? { description: input.publication.description } : {}),
    basicTheme: {
      $type: "site.standard.theme.basic",
      background: rgb(input.publication.palette.surface),
      foreground: rgb(input.publication.palette.text),
      accent: rgb(input.publication.palette.accent),
      accentForeground: rgb(contrastColor(input.publication.palette.accent ?? "#000000")),
    },
    preferences: { showInDiscover: input.publication.showInDiscover },
  });

  for (const document of input.documents) {
    const rkey = documentRkeys[document.pageId] ?? nextTid();
    documentRkeys[document.pageId] = rkey;
    await repo.putRecord(STANDARD_DOCUMENT, rkey, {
      $type: STANDARD_DOCUMENT,
      site: publicationUri,
      path: document.path.startsWith("/") ? document.path : `/${document.path}`,
      title: document.title,
      ...(document.description ? { description: document.description } : {}),
      ...(document.textContent ? { textContent: document.textContent } : {}),
      ...(document.tags.length ? { tags: document.tags } : {}),
      publishedAt: document.publishedAt,
      updatedAt: document.updatedAt,
    });
  }

  const active = new Set(input.documents.map((document) => document.pageId));
  for (const [pageId, rkey] of Object.entries(documentRkeys)) {
    if (!active.has(pageId)) {
      await repo.deleteRecord(STANDARD_DOCUMENT, rkey).catch(() => undefined);
      delete documentRkeys[pageId];
    }
  }

  return { publicationUri, publicationRkey, documentRkeys };
}

function rgb(css: string | undefined): Record<string, unknown> {
  const parsed = parseColor(css ?? "#ffffff");

  return {
    $type: "site.standard.theme.color#rgb",
    r: parsed[0],
    g: parsed[1],
    b: parsed[2],
  };
}

function contrastColor(css: string): string {
  const [r, g, b] = parseColor(css);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance < 0.55 ? "#ffffff" : "#000000";
}

function parseColor(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})/i.exec(css.trim());
  if (hex) {
    const value = Number.parseInt(hex[1]!, 16);

    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgbMatch = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css.trim());
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }

  return [255, 255, 255];
}

/** A TID, the record key both Standard.site lexicons require. */
let lastTid = 0n;
export function nextTid(now = Date.now()): string {
  const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
  let value = (BigInt(now) * 1000n) << 10n;
  if (value <= lastTid) value = lastTid + 1n;
  lastTid = value;
  let output = "";
  for (let index = 0; index < 13; index++) {
    output = alphabet[Number(value & 31n)] + output;
    value >>= 5n;
  }

  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
