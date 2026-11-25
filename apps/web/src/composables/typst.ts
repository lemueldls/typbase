import type { FileId, ThemeColors } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";

import { TYPST_EDITOR_LINE_HEIGHT } from "@typbase/codemirror";
import init, { TypstState } from "@typbase/engine";
import { isTauri } from "@typbase/storage";

import { effectiveLocale } from "~/composables/appLocale";
import { currentThemeColors } from "~/composables/theme";
import { installCustomFonts } from "~/lib/customFonts";
import {
  registerFontFaceSource,
  syncCustomFontFaces,
  unregisterFontFaceSource,
} from "~/lib/fontFaces";
import { forgetInstalledFontPack, installedFontPacks, readFontPack } from "~/lib/fontPacks";
import { wasmBinaryUrl } from "~/lib/wasmUrl";

export function getTypstFontImports() {
  return [
    [
      import("~~/public/fonts/code/IosevkaConcreteCode-Regular.ttf?url"),
      import("~~/public/fonts/code/IosevkaConcreteCode-Italic.ttf?url"),
      import("~~/public/fonts/code/IosevkaConcreteCode-Bold.ttf?url"),
      import("~~/public/fonts/code/IosevkaConcreteCode-BoldItalic.ttf?url"),
    ],
    [
      import("~~/public/fonts/text/IosevkaConcreteText-Regular.ttf?url"),
      import("~~/public/fonts/text/IosevkaConcreteText-Italic.ttf?url"),
      import("~~/public/fonts/text/IosevkaConcreteText-Bold.ttf?url"),
      import("~~/public/fonts/text/IosevkaConcreteText-BoldItalic.ttf?url"),
    ],
    [
      import("~~/public/fonts/math/ConcreteMath-Regular.otf?url"),
      import("~~/public/fonts/math/ConcreteMath-Bold.otf?url"),
    ],
  ];
}

let statePromise: Promise<TypstState> | undefined;

export async function createTypstState(): Promise<TypstState> {
  // Idempotent once the module is loaded, and it retries after a failed first
  // download. Recovery calls this directly, so it must not assume the module
  // was initialized.
  await init({ module_or_path: wasmBinaryUrl });
  const typstState = new TypstState();

  for (const fontImports of getTypstFontImports()) {
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(
      fontImports.map(async (fontImport) => {
        const { default: fileUrl } = await fontImport;

        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        typstState.installFont(bytes);
      }),
    );
  }

  if (import.meta.dev) {
    // The debug lab reads this to report wasm heap growth.
    (window as unknown as { __typstState: TypstState }).__typstState = typstState;
  }

  return typstState;
}

/**
 * One TypstState per page session. The WASM instance is expensive to build,
 * so it loads lazily the first time an editor mounts, on the client.
 */
export function useTypst() {
  statePromise ??= createTypstState().catch((cause) => {
    // Drop a failed load so the next caller starts over instead of replaying
    // the same rejection.
    statePromise = undefined;
    throw cause;
  });

  return statePromise;
}

/** Longest boot or recovery waits for the wasm module and bundled fonts. */
export const ENGINE_LOAD_TIMEOUT_MS = 20_000;

/**
 * Replaces the cached instance after a wasm panic. Future useTypst() callers
 * get the fresh state. Open panes recompile through their own remount keys.
 */
export function replaceTypstState(state: TypstState): void {
  statePromise = Promise.resolve(state);
}

/**
 * Clears Typst's memoization caches when an engine instance is already
 * loaded. The caches speed up repeated compiles but grow for the session.
 * Workspace switches call this because the next compiles are cold anyway.
 */
export function evictTypstCaches(): void {
  void statePromise?.then((state) => state.evictCaches()).catch(() => undefined);
}

/**
 * The live instance's wasm heap: 0 before an engine exists, and -1 once the
 * instance is wedged, since the call traps then. Reading it never boots an
 * engine, so a status readout can poll it.
 */
export async function typstHeapBytes(): Promise<number> {
  if (!statePromise) return 0;

  try {
    return (await statePromise).memoryBytes();
  } catch {
    return -1;
  }
}

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

/** Not in lib.dom yet (Local Font Access API), so declare the surface we use. */
declare global {
  interface Window {
    queryLocalFonts?(options?: {
      select?: Array<{ family: string; style?: string }>;
    }): Promise<LocalFontData[]>;
  }
}

export const systemFontFamilies = ref<string[]>([]);
export const systemFontsLoaded = ref(false);
export const systemFontsLoading = ref(false);
export const systemFontsError = ref<string | null>(null);

interface TauriFontFace {
  families: string[];
  style: string;
  monospaced: boolean;
  math: boolean;
  math_only: boolean;
  text: boolean;
  index: number;
}

type LocalFontFace = LocalFontData;

/** Picker lists per purpose. Bundled fonts always stay available. */
export interface SystemFontOptions {
  text: string[];
  math: string[];
  code: string[];
}

/** Families that ship with the app, so a picker can label them as built in. */
export const BUNDLED_FONTS: SystemFontOptions = {
  text: ["Iosevka Concrete Text"],
  math: ["Concrete Math"],
  code: ["Iosevka Concrete Code"],
};

function freshOptions(): SystemFontOptions {
  return {
    text: [...BUNDLED_FONTS.text],
    math: [...BUNDLED_FONTS.math],
    code: [...BUNDLED_FONTS.code],
  };
}

export const systemFontOptions = ref<SystemFontOptions>(freshOptions());

let localFontFaces: LocalFontFace[] = [];
let tauriFontFaces: TauriFontFace[] = [];

/**
 * Families whose bytes already live in a given wasm instance. Keyed by state:
 * panic recovery builds a fresh TypstState, and the fonts must load again.
 */
const installedFamilies = new WeakMap<TypstState, Set<string>>();

function installedFor(typstState: TypstState): Set<string> {
  let families = installedFamilies.get(typstState);
  if (!families) {
    families = new Set();
    installedFamilies.set(typstState, families);
  }

  return families;
}

/** Browsers expose names only, so bucket by name. The shell sends metadata. */
const MATH_NAME = /math|stix|xits|asana|neo euler/i;
const MONO_NAME =
  /mono|code|consol|courier|menlo|iosevka|jetbrains|fira|hack|inconsolata|cascadia|typewriter/i;

function isFamily(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

let fontInstallChain: Promise<void> = Promise.resolve();

/**
 * Loads the bytes for families the engine will actually use. A full system
 * font set can be hundreds of megabytes, so neither backend installs
 * everything: the picker only needs names, and `setFont` only needs the
 * configured families.
 */
export function ensureFontsInstalled(
  typstState: TypstState,
  families: Array<string | null | undefined>,
): Promise<void> {
  fontInstallChain = fontInstallChain
    .catch(() => {
      // A failed batch must not stall later ones.
    })
    .then(() => installMissingFonts(typstState, families));

  return fontInstallChain;
}

/** Number of faces the system index found for a family. */
export function systemFontFaceCount(family: string): number {
  if (isTauri()) {
    return tauriFontFaces.filter((face) => face.families.includes(family)).length;
  }

  return localFontFaces.filter((face) => face.family === family).length;
}

/**
 * Reads every face of one installed family. Call `loadSystemFonts` first so
 * the backend has an index to read from.
 */
export async function readSystemFontFamily(family: string): Promise<Uint8Array[]> {
  const payloads: Uint8Array[] = [];

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    for (const face of tauriFontFaces.filter((entry) => entry.families.includes(family))) {
      payloads.push(
        new Uint8Array(await invoke<ArrayBuffer>("system_font_file", { index: face.index })),
      );
    }

    return payloads;
  }

  for (const face of localFontFaces.filter((entry) => entry.family === family)) {
    const blob = await face.blob();
    payloads.push(new Uint8Array(await blob.arrayBuffer()));
  }

  return payloads;
}

async function installMissingFonts(
  typstState: TypstState,
  families: Array<string | null | undefined>,
): Promise<void> {
  const installed = installedFor(typstState);
  const wanted = [...new Set(families.filter(isFamily))].filter((family) => !installed.has(family));
  if (wanted.length === 0) return;

  const installedNow = new Set<string>();

  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");

      for (const family of wanted) {
        for (const face of tauriFontFaces.filter((entry) => entry.families.includes(family))) {
          const buffer = await invoke<ArrayBuffer>("system_font_file", { index: face.index });
          typstState.installFont(new Uint8Array(buffer));
          installedNow.add(family);
        }
      }
    } else {
      for (const family of wanted) {
        for (const face of localFontFaces.filter((entry) => entry.family === family)) {
          const blob = await face.blob();
          typstState.installFont(new Uint8Array(await blob.arrayBuffer()));
          installedNow.add(family);
        }
      }
    }
  } catch (error) {
    // Font loading is additive. Surface the reason and keep the app running.
    systemFontsError.value = error instanceof Error ? error.message : String(error);
    return;
  }

  // Mark missing families only once the index is known, so a later index
  // load can still install them.
  for (const family of wanted) {
    if (installedNow.has(family) || systemFontsLoaded.value) installed.add(family);
  }

  if (installedNow.size > 0) bumpRenderRevision();
}

/**
 * Enumerates installed fonts. On desktop the shell's fontdb index is used,
 * while browsers need the Local Font Access API (Chromium). Only the `families`
 * passed in are installed into the engine.
 */
export async function loadSystemFonts(
  typstState: TypstState,
  families: Array<string | null | undefined> = [],
): Promise<void> {
  systemFontsLoading.value = true;
  systemFontsError.value = null;

  try {
    const allFamilies = new Set<string>();
    const options = freshOptions();
    const add = (bucket: keyof SystemFontOptions, family: string) => {
      if (!options[bucket].includes(family)) options[bucket].push(family);
    };

    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      tauriFontFaces = await invoke<TauriFontFace[]>("system_font_index");

      for (const face of tauriFontFaces) {
        for (const family of face.families) {
          allFamilies.add(family);
          if (face.math) add("math", family);
          if (face.text && !face.math_only) add("text", family);
          if (face.monospaced && face.text) add("code", family);
        }
      }
    } else {
      if (!window.queryLocalFonts) {
        systemFontsError.value = "This browser does not support the Local Font Access API.";
        throw new Error(systemFontsError.value);
      }

      const fonts = await window.queryLocalFonts();
      localFontFaces = fonts;

      for (const font of fonts) {
        const family = font.family;
        allFamilies.add(family);
        if (MATH_NAME.test(family)) add("math", family);
        if (MONO_NAME.test(family)) add("code", family);
        if (!MATH_NAME.test(family)) add("text", family);
      }
    }

    const byName = (a: string, b: string) => a.localeCompare(b);
    options.text.sort(byName);
    options.math.sort(byName);
    options.code.sort(byName);
    systemFontOptions.value = options;
    systemFontFamilies.value = [...allFamilies].sort(byName);

    systemFontsLoaded.value = true;
    await ensureFontsInstalled(typstState, families);
  } catch (error) {
    systemFontsError.value = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    systemFontsLoading.value = false;
  }
}

/** Installs the workspace font/theme settings into its space context. */
export function applyWorkspaceStyle(
  typstState: TypstState,
  configId: FileId,
  settings: {
    font: string;
    mathFont: string | null;
    codeFont: string | null;
    /** Body text size in pt (1 pt renders as 1 px, like the editor). */
    textSize: number;
    /** Ligatures and kerning, applied to every compile of this workspace. */
    ligatures: boolean;
    kerning: boolean;
    /** App locale, which becomes the document's `text(lang:)`. */
    locale: string;
    /** Apply Typbase's document rules for headings, links, code, and quotes. */
    documentStyle: boolean;
    /** Renderer palette for the current workspace theme. */
    themeColors: ThemeColors;
  },
): void {
  typstState.setFont(configId, settings.font);
  typstState.setMathFont(configId, settings.mathFont);
  typstState.setCodeFont(configId, settings.codeFont);
  typstState.setTextSize(configId, settings.textSize);
  typstState.setTypography(configId, settings.ligatures, settings.kerning);
  typstState.setLocale(configId, settings.locale);
  typstState.setDocumentStyle(configId, settings.documentStyle);
  // Frame crops start at the editor's line box, so a rendered block and the
  // source text it replaces share a baseline.
  typstState.setLineHeightRatio(configId, TYPST_EDITOR_LINE_HEIGHT);
  // Rendered pages follow the app theme: the palette derives from the same
  // tokens the chrome uses.
  typstState.setTheme(configId, settings.themeColors);
}

/**
 * Hidden config file ids, one per workspace and per wasm instance. The space
 * context (fonts, theme, locale) hangs off the file's space id, so reusing a
 * single id across workspaces would apply the new settings to the old workspace's
 * context and leave the switched workspace rendering with defaults. Keyed by
 * state: panic recovery installs a fresh instance whose file ids mean nothing.
 */
const workspaceConfigIds = new WeakMap<TypstState, Map<string, FileId>>();

function workspaceConfigId(typstState: TypstState, workspaceId: string): FileId {
  let perState = workspaceConfigIds.get(typstState);
  if (!perState) {
    perState = new Map();
    workspaceConfigIds.set(typstState, perState);
  }

  let id = perState.get(workspaceId);
  if (!id) {
    // One path per workspace: FileIds intern by path, so a shared path would
    // resolve both workspaces to the same id and re-point its context.
    id = typstState.createSourceId(`typbase-config-${workspaceId}`, workspaceId);
    perState.set(workspaceId, id);
  }

  return id;
}

/**
 * Packs already installed into a given wasm instance. Panic recovery builds a
 * fresh state, and the faces have to load again.
 */
const installedPacks = new WeakMap<TypstState, Set<string>>();

/**
 * Installs the device's downloaded language packs into one wasm instance.
 *
 * A pack whose cache entry disappeared is forgotten, so the page notice
 * offers the download again instead of claiming the font is present.
 */
export async function installFontPacks(typstState: TypstState): Promise<void> {
  let seen = installedPacks.get(typstState);
  if (!seen) {
    seen = new Set();
    installedPacks.set(typstState, seen);
  }

  let added = false;
  for (const pack of installedFontPacks.value) {
    if (seen.has(pack.id)) continue;

    // oxlint-disable-next-line no-await-in-loop
    const bytes = await readFontPack(pack);
    if (!bytes) {
      forgetInstalledFontPack(pack.id);
      unregisterFontFaceSource(`pack:${pack.id}`);
      continue;
    }

    try {
      typstState.installFont(bytes);
      // The app chrome and source editor read CSS families. The engine copy
      // alone leaves them on a system fallback. Packs can be large, so let the
      // CSS face load alongside the compile instead of blocking the style
      // apply.
      void registerFontFaceSource(`pack:${pack.id}`, pack.family, bytes).catch((cause) => {
        console.warn("[fonts] pack face registration failed:", pack.id, cause);
      });
      seen.add(pack.id);
      added = true;
    } catch (cause) {
      // A failed engine must not drop a verified download. The next style
      // apply, usually after recovery, tries again.
      console.warn("[fonts] language pack install failed:", pack.id, cause);
    }
  }

  if (added) bumpRenderRevision();
}

/**
 * (Re)applies the workspace font settings to the wasm instance. Call after
 * settings change or once before opening the first page. Every page in a
 * workspace shares one space context, so one hidden file id per workspace is
 * enough.
 */
export async function applyWorkspaceStyleToTypst(
  workspaceId: string,
  store: WorkspaceStore,
  extraFamilies: string[] = [],
): Promise<void> {
  const typstState = await useTypst();
  const settings = store.getSettings();

  // Desktop shells can enumerate fonts without a user gesture, so the index
  // is ready before the first font picker opens. Only configured families
  // load bytes.
  if (isTauri() && !systemFontsLoaded.value && !systemFontsLoading.value) {
    await loadSystemFonts(typstState).catch(() => {
      // The error lands in systemFontsError for the settings UI.
    });
  }
  await ensureFontsInstalled(typstState, [
    settings.font,
    settings.mathFont,
    settings.codeFont,
    ...extraFamilies,
  ]);
  // Uploaded faces come from the workspace's blobs, not from the system, so
  // they install separately. Without this a workspace font renders in the
  // picker and falls back in the document.
  await installCustomFonts(typstState, store);
  // Uploaded faces are engine-only until they reach the browser's font set.
  // The source editor and chrome read CSS families, so register them too.
  await syncCustomFontFaces(store);
  // Device packs cover scripts the bundled faces do not. A fresh state needs
  // them again, so this runs with every style apply.
  await installFontPacks(typstState);

  applyWorkspaceStyle(typstState, workspaceConfigId(typstState, workspaceId), {
    font: settings.font,
    mathFont: settings.mathFont,
    codeFont: settings.codeFont,
    textSize: settings.textSize,
    ligatures: settings.typography.ligatures,
    kerning: settings.typography.kerning,
    locale: effectiveLocale(settings),
    documentStyle: settings.documentStyle,
    themeColors: currentThemeColors(settings),
  });
}

/**
 * Bumped when rendering state changes outside the docs (system fonts loaded).
 * The open editor recompiles on it.
 */
export const renderRevision = ref(0);

export function bumpRenderRevision(): void {
  renderRevision.value += 1;
}
