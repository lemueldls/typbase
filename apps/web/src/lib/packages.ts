import type { InstalledPackage } from "@typbase/typing";

/** Universe namespace the browser reads. Typst ships `preview`. */
export const PACKAGE_NAMESPACE = "preview";

export const PACKAGE_INDEX_URL = "https://packages.typst.org/preview/index.json";

const PACKAGE_BASE_URL = "https://packages.typst.org";

/** One `index.json` row. Optional fields are absent on older entries. */
export interface UniversePackage {
  name: string;
  version: string;
  entrypoint: string;
  description: string;
  authors?: string[];
  license?: string;
  repository?: string;
  keywords?: string[];
  categories?: string[];
  compiler?: string;
  updatedAt?: number;
}

/** All versions of one package, newest first. */
export interface PackageEntry {
  name: string;
  description: string;
  versions: UniversePackage[];
}

/**
 * Template categories are not useful as dependencies. Universe tags them on
 * the index; the browser hides them the same way mnemo does.
 */
const TEMPLATE_CATEGORIES = new Set([
  "book",
  "report",
  "paper",
  "thesis",
  "poster",
  "flyer",
  "presentation",
  "cv",
  "office",
]);

export function specString(pkg: InstalledPackage): string {
  return `@${pkg.namespace}/${pkg.name}:${pkg.version}`;
}

export function tarballUrl(pkg: InstalledPackage): string {
  return `${PACKAGE_BASE_URL}/${pkg.namespace}/${pkg.name}-${pkg.version}.tar.gz`;
}

export function samePackage(left: InstalledPackage, right: InstalledPackage): boolean {
  return (
    left.namespace === right.namespace && left.name === right.name && left.version === right.version
  );
}

let indexPromise: Promise<PackageEntry[]> | undefined;

/**
 * The Universe index, fetched once per session. A failed load clears the
 * promise so opening the browser again retries; `force` skips both the
 * in-memory promise and the HTTP cache.
 */
export function loadPackageIndex(force = false): Promise<PackageEntry[]> {
  if (force) indexPromise = undefined;

  indexPromise ??= fetchPackageIndex(force).catch((error: unknown) => {
    indexPromise = undefined;
    throw error;
  });

  return indexPromise;
}

async function fetchPackageIndex(force: boolean): Promise<PackageEntry[]> {
  const response = await fetch(PACKAGE_INDEX_URL, force ? { cache: "reload" } : undefined);
  if (!response.ok) throw new Error(`package index: HTTP ${response.status}`);

  const rows = (await response.json()) as UniversePackage[];
  const byName = new Map<string, PackageEntry>();

  for (const row of rows) {
    if (row.categories?.some((category) => TEMPLATE_CATEGORIES.has(category))) continue;

    const entry = byName.get(row.name) ?? {
      name: row.name,
      description: row.description,
      versions: [],
    };
    entry.versions.push(row);
    byName.set(row.name, entry);
  }

  const entries = [...byName.values()];
  for (const entry of entries) {
    entry.versions.sort((left, right) => compareVersions(right.version, left.version));
    entry.description = entry.versions[0]?.description ?? entry.description;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  return entries;
}

/** Newest entry for a package; `versions` is sorted newest first. */
export function latestVersion(entry: PackageEntry): UniversePackage | undefined {
  return entry.versions[0];
}

/** Ranks one entry for a query. 0 means no match. */
export function matchScore(entry: PackageEntry, needle: string): number {
  const name = entry.name.toLowerCase();
  if (name === needle) return 1000;
  if (name.startsWith(needle)) return 600 - name.length;
  if (name.includes(needle)) return 400;

  const latest = latestVersion(entry);
  const tags = [...(latest?.keywords ?? []), ...(latest?.categories ?? [])].map((tag) =>
    tag.toLowerCase(),
  );
  if (tags.includes(needle)) return 300;
  if (tags.some((tag) => tag.includes(needle))) return 200;

  if (entry.description.toLowerCase().includes(needle)) return 100;
  if (latest?.authors?.some((author) => author.toLowerCase().includes(needle))) return 50;

  return 0;
}

/**
 * Entries matching a query, best first. Name matches beat keywords, keywords
 * beat the description; ties fall back to the name. An empty query returns
 * the entries untouched.
 */
export function searchPackages(entries: PackageEntry[], query: string): PackageEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;

  return entries
    .map((entry) => ({ entry, score: matchScore(entry, needle) }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .map((candidate) => candidate.entry);
}

/** One run of text and whether it matches the search needle. */
export interface TextSegment {
  text: string;
  match: boolean;
}

/** Splits `text` into alternating plain and matched runs for highlighting. */
export function highlightSegments(text: string, needle: string): TextSegment[] {
  if (!needle) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;

    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }

  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), match: false });
  }

  return segments;
}

/** Numeric semver compare for `major.minor.patch` plus an optional pre-release. */
export function compareVersions(left: string, right: string): number {
  const [leftMain = "", leftPre = ""] = left.split("-", 2);
  const [rightMain = "", rightPre = ""] = right.split("-", 2);
  const leftParts = leftMain.split(".").map(Number);
  const rightParts = rightMain.split(".").map(Number);

  for (let index = 0; index < 3; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  if (leftPre === rightPre) return 0;
  // A pre-release sorts before the release it belongs to.
  if (leftPre === "") return 1;
  if (rightPre === "") return -1;

  return leftPre.localeCompare(rightPre);
}

const PACKAGE_CACHE = "typbase-packages";

/**
 * Tarball bytes, cache-first. Package versions are immutable, so a cached
 * response never needs revalidation. Cache Storage is optional: private
 * windows and some webviews reject it, and a plain fetch still works.
 */
export async function fetchPackageBytes(pkg: InstalledPackage): Promise<Uint8Array> {
  const url = tarballUrl(pkg);
  const cache = await openPackageCache();
  const cached = await cache?.match(url);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${specString(pkg)}: HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/gzip" } }));

  return bytes;
}

async function openPackageCache(): Promise<Cache | undefined> {
  if (typeof caches === "undefined") return undefined;

  try {
    return await caches.open(PACKAGE_CACHE);
  } catch {
    return undefined;
  }
}
