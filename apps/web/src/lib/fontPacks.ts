import { computed, ref } from "vue";

import type { FontPayload } from "./customFonts";

/**
 * Downloadable fonts for scripts the bundled faces do not cover.
 *
 * The bytes live on the device, not in the workspace. A CJK face is larger
 * than the workspace asset blob cap, so putting one in `customFonts` would
 * fail to sync and would follow every export and published site. Packs are
 * fetched once, cached in Cache Storage, and installed into the wasm states
 * that need them.
 */
export interface FontPack {
  id: string;
  /** Family the engine resolves, as the font's own name table declares it. */
  family: string;
  /** Native label for the script or language, shown without translation. */
  label: string;
  /** ISO 15924 short codes the face covers. `Emoji` is a pseudo-code. */
  scripts: string[];
  url: string;
  bytes: number;
  sha256: string;
}

/**
 * Google serves these from content-versioned URLs. The hash pins the exact
 * bytes reviewed here, so a changed file at the same address is rejected.
 * Updating a pack means updating both fields together.
 */
export const FONT_PACKS: FontPack[] = [
  {
    id: "cjk-sc",
    family: "Noto Sans SC",
    label: "简体中文",
    scripts: ["Hani", "Hira", "Kana"],
    url: "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzT3HI.ttf",
    bytes: 10_863_592,
    sha256: "0b41e56683e7c5f844d7399565c1f3578affa015db9c17c11a569b9758c45ba5",
  },
  {
    id: "cjk-tc",
    family: "Noto Sans TC",
    label: "繁體中文",
    scripts: ["Hani", "Hira", "Kana"],
    url: "https://fonts.gstatic.com/s/notosanstc/v40/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_CpOtma2gNc.ttf",
    bytes: 7_317_284,
    sha256: "d90872343982ddb8c4c1cb1c20555871d71daffae1560025f2eacc8505330df4",
  },
  {
    id: "cjk-jp",
    family: "Noto Sans JP",
    label: "日本語",
    scripts: ["Hani", "Hira", "Kana"],
    url: "https://fonts.gstatic.com/s/notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75vY0rw_mMI.ttf",
    bytes: 5_451_440,
    sha256: "88e2476a4c7b99f2349e429440c762b1604f1e28dd32c78313829f1cb36e1164",
  },
  {
    id: "cjk-kr",
    family: "Noto Sans KR",
    label: "한국어",
    scripts: ["Hani", "Hira", "Kana", "Hang"],
    url: "https://fonts.gstatic.com/s/notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4gReI.ttf",
    bytes: 6_076_292,
    sha256: "94ed5cabd403712c2847175828f73afae30e755d20ecd66c6a705f070dddf6d3",
  },
  {
    id: "arabic",
    family: "Noto Sans Arabic",
    label: "العربية",
    scripts: ["Arab"],
    url: "https://fonts.gstatic.com/s/notosansarabic/v33/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfyGyvu3CBFQPiiQ.ttf",
    bytes: 340_420,
    sha256: "7567228c96469e04ac8efabf9e1f4e19945a1cca02c2ebb0264b41785542086e",
  },
  {
    id: "hebrew",
    family: "Noto Sans Hebrew",
    label: "עברית",
    scripts: ["Hebr"],
    url: "https://fonts.gstatic.com/s/notosanshebrew/v50/or3HQ7v33eiDljA1IufXTtVf7V6RvEEdhQlk0LlGxCyaeNKYZC0sqk3xXGiXd4qtoiJltupp2Q.ttf",
    bytes: 47_748,
    sha256: "d3aba1d30953fd45136141c77be6c5a3e1fb584cb60f61db7fdee77195bc74ca",
  },
  {
    id: "devanagari",
    family: "Noto Sans Devanagari",
    label: "हिन्दी",
    scripts: ["Deva"],
    url: "https://fonts.gstatic.com/s/notosansdevanagari/v33/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlXQly-AzoFoX2O8.ttf",
    bytes: 220_832,
    sha256: "f61da9acc30ed75b94c0c726d7b716ad8cee601c6a5fec8181ceacf37d0d734b",
  },
  {
    id: "thai",
    family: "Noto Sans Thai",
    label: "ไทย",
    scripts: ["Thai"],
    url: "https://fonts.gstatic.com/s/notosansthai/v29/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU5RtpzF-QRvy9Xs.ttf",
    bytes: 46_868,
    sha256: "63fc614dc300218ba6886b9442574e730b6bdcba4be7daedfa5dd3d6ebee37b5",
  },
  {
    id: "bengali",
    family: "Noto Sans Bengali",
    label: "বাংলা",
    scripts: ["Beng"],
    url: "https://fonts.gstatic.com/s/notosansbengali/v33/Cn-SJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mcSPVFpVEqE-6KmsolLudCk8izJ6lQ.ttf",
    bytes: 141_324,
    sha256: "6480f6f2aea1bc674151b4efd63f1bc099addb0ffee8e183f027b07e4f1f11a8",
  },
  {
    id: "tamil",
    family: "Noto Sans Tamil",
    label: "தமிழ்",
    scripts: ["Taml"],
    url: "https://fonts.gstatic.com/s/notosanstamil/v31/ieVc2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-0429tBManUktuex7vGo70RqKDt_XPQ.ttf",
    bytes: 85_300,
    sha256: "e7f84d877db2e473d4be24749d800b9ced64d68d31686a2984f6d3d9353f3f90",
  },
  {
    id: "emoji",
    family: "Noto Emoji",
    label: "Emoji",
    scripts: ["Emoji"],
    url: "https://fonts.gstatic.com/s/notoemoji/v65/bMrnmSyK7YY-MEu6aWjPDs-ar6uWaGWuob-r0jwvS-FGJRsa.ttf",
    bytes: 920_740,
    sha256: "7130f71ad3b2eb2f62047a2c7eeacb2ef30616c50ff56bce66b8f99c3ea45971",
  },
];

const FONT_PACK_CACHE = "typbase-fonts";

const STORAGE_KEY = "typbase:fontPacks";

/** ISO 15924 codes grouped for the notice and the pack chooser. */
export const SCRIPT_LABEL_KEYS: Record<string, string> = {
  Hani: "fontPacks.scriptHani",
  Hira: "fontPacks.scriptHira",
  Kana: "fontPacks.scriptKana",
  Hang: "fontPacks.scriptHang",
  Arab: "fontPacks.scriptArab",
  Hebr: "fontPacks.scriptHebr",
  Deva: "fontPacks.scriptDeva",
  Thai: "fontPacks.scriptThai",
  Beng: "fontPacks.scriptBeng",
  Taml: "fontPacks.scriptTaml",
  Emoji: "fontPacks.scriptEmoji",
};

export class FontPackError extends Error {
  constructor(
    readonly code: "download" | "integrity" | "cache",
    message: string,
  ) {
    super(message);
    this.name = "FontPackError";
  }
}

function readStoredIds(): string[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];

    const known = new Set(FONT_PACKS.map((pack) => pack.id));

    return parsed.filter((id): id is string => typeof id === "string" && known.has(id));
  } catch {
    return [];
  }
}

export const installedFontPackIds = ref<string[]>(readStoredIds());

export const installedFontPacks = computed(() =>
  FONT_PACKS.filter((pack) => installedFontPackIds.value.includes(pack.id)),
);

function writeStoredIds(): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(installedFontPackIds.value));
  } catch {
    // A full quota only loses the marker, not the cached bytes. The user can
    // install again and the cache hit skips the download.
  }
}

function addInstalledFontPack(id: string): void {
  if (installedFontPackIds.value.includes(id)) return;

  installedFontPackIds.value = [...installedFontPackIds.value, id];
  writeStoredIds();
}

/** Drops the installed marker without touching the cached bytes. */
export function forgetInstalledFontPack(id: string): void {
  if (!installedFontPackIds.value.includes(id)) return;

  installedFontPackIds.value = installedFontPackIds.value.filter((entry) => entry !== id);
  writeStoredIds();
}

export function fontPackById(id: string): FontPack | undefined {
  return FONT_PACKS.find((pack) => pack.id === id);
}

/** Scripts a source uses. Used to decide which packs an export needs. */
export function scriptsInText(text: string): string[] {
  const found: string[] = [];

  for (const [code, pattern] of SCRIPT_PATTERNS) {
    if (pattern.test(text)) found.push(code);
  }

  return found;
}

/** Packs that can draw every missing script, or any overlapping pack when none can. */
export function packsForScripts(scripts: readonly string[]): FontPack[] {
  if (!scripts.length) return [...FONT_PACKS];

  const wanted = new Set(scripts);
  const covering = FONT_PACKS.filter((pack) =>
    scripts.every((code) => pack.scripts.includes(code)),
  );
  const pool = covering.length
    ? covering
    : FONT_PACKS.filter((pack) => pack.scripts.some((code) => wanted.has(code)));
  const preferred = scripts.includes("Hang")
    ? "cjk-kr"
    : scripts.includes("Hira") || scripts.includes("Kana")
      ? "cjk-jp"
      : null;

  return preferred
    ? [...pool].sort(
        (left, right) => Number(right.id === preferred) - Number(left.id === preferred),
      )
    : pool;
}

/** Installed packs whose script appears in at least one source. */
export function installedPacksForText(...sources: string[]): FontPack[] {
  const scripts = new Set<string>();
  for (const source of sources) {
    for (const code of scriptsInText(source)) scripts.add(code);
  }

  return installedFontPacks.value.filter((pack) => pack.scripts.some((code) => scripts.has(code)));
}

const cachedBytes = new Map<string, Uint8Array>();

/** Cached bytes for a pack, or null when the device cache lost them. */
export async function readFontPack(pack: FontPack): Promise<Uint8Array | null> {
  const memory = cachedBytes.get(pack.id);
  if (memory) return memory;
  if (typeof caches === "undefined") return null;

  const store = await caches.open(FONT_PACK_CACHE).catch(() => null);
  const response = store ? await store.match(pack.url).catch(() => undefined) : undefined;
  if (!response) return null;

  const bytes = new Uint8Array(await response.arrayBuffer());
  cachedBytes.set(pack.id, bytes);

  return bytes;
}

/** Downloads, verifies and caches one pack, then marks it installed. */
export async function downloadFontPack(
  pack: FontPack,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(pack.url);
  } catch (cause) {
    throw new FontPackError("download", String(cause));
  }
  if (!response.ok) {
    throw new FontPackError("download", `HTTP ${response.status}`);
  }

  const bytes = await readBody(response, pack.bytes, onProgress);
  const digest = await sha256Hex(bytes);
  if (digest !== pack.sha256) {
    throw new FontPackError("integrity", `${pack.id} hash ${digest}`);
  }

  let store: Cache;
  try {
    store = await caches.open(FONT_PACK_CACHE);
  } catch (cause) {
    throw new FontPackError("cache", String(cause));
  }

  try {
    await store.put(
      pack.url,
      new Response(bytes as BodyInit, {
        headers: {
          "content-type": "font/ttf",
          "content-length": String(bytes.byteLength),
        },
      }),
    );
  } catch (cause) {
    throw new FontPackError("cache", String(cause));
  }

  cachedBytes.set(pack.id, bytes);
  addInstalledFontPack(pack.id);
  onProgress?.(1);

  return bytes;
}

/** Drops the cache entry and the installed marker. The live engine keeps the face. */
export async function deleteFontPack(id: string): Promise<void> {
  const pack = fontPackById(id);
  if (!pack) return;

  cachedBytes.delete(id);
  if (typeof caches !== "undefined") {
    const store = await caches.open(FONT_PACK_CACHE).catch(() => null);
    await store?.delete(pack.url);
  }
  forgetInstalledFontPack(id);
}

/** Faces for a worker's world. Byte arrays stay identical between calls. */
export async function fontPackPayloads(): Promise<FontPayload[]> {
  const payloads: FontPayload[] = [];

  for (const pack of installedFontPacks.value) {
    // oxlint-disable-next-line no-await-in-loop
    const bytes = await readFontPack(pack);
    if (bytes) payloads.push({ family: pack.family, bytes });
  }

  return payloads;
}

async function readBody(
  response: Response,
  fallbackSize: number,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("content-length")) || fallbackSize;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(1);

    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    chunks.push(value);
    received += value.byteLength;
    if (total > 0) onProgress?.(Math.min(1, received / total));
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(1);

  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const SCRIPT_PATTERNS: Array<[string, RegExp]> = [
  ["Hani", /[\p{Script=Han}\u3000-\u303F\uFE30-\uFE4F\uFF00-\uFFEF]/u],
  ["Hira", /\p{Script=Hiragana}/u],
  ["Kana", /\p{Script=Katakana}/u],
  ["Hang", /\p{Script=Hangul}/u],
  ["Arab", /\p{Script=Arabic}/u],
  ["Hebr", /\p{Script=Hebrew}/u],
  ["Deva", /\p{Script=Devanagari}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Beng", /\p{Script=Bengali}/u],
  ["Taml", /\p{Script=Tamil}/u],
  ["Emoji", /\p{Extended_Pictographic}/u],
];
