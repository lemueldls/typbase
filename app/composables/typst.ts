import type { WorkspaceSettings } from "@typbase/typing";
import type { FileId, ThemeColors } from "@typbase/wasm";

import { isTauri } from "@typbase/storage";
import init, { TypstState } from "@typbase/wasm";

import { currentThemeColors } from "~/composables/theme";

export function getTypstFontImports() {
  return [
    [
      import("~~/public/fonts/maple/MapleMono-Regular.ttf?url"),
      import("~~/public/fonts/maple/MapleMono-Italic.ttf?url"),
      import("~~/public/fonts/maple/MapleMono-Bold.ttf?url"),
      import("~~/public/fonts/maple/MapleMono-BoldItalic.ttf?url"),
    ],
    [
      import("~~/public/fonts/math/NewCMMath-Regular.otf?url"),
      import("~~/public/fonts/math/NewCMMath-Bold.otf?url"),
    ],
  ];
}

let statePromise: Promise<TypstState> | undefined;

export async function createTypstState(): Promise<TypstState> {
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
  statePromise ??= init().then(createTypstState);

  return statePromise;
}

/**
 * Replaces the cached instance after a wasm panic. Future useTypst() callers
 * get the fresh state; open panes recompile through their own remount keys.
 */
export function replaceTypstState(state: TypstState): void {
  statePromise = Promise.resolve(state);
  // The wasm context lives inside the instance, not in this module.
  workspaceConfigId = undefined;
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

const BUNDLED_FONTS: SystemFontOptions = {
  text: ["Maple Mono"],
  math: ["New Computer Modern Math"],
  code: ["Maple Mono"],
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

/** Browsers expose names only, so bucket by name; the shell sends metadata. */
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
    // Font loading is additive; surface the reason and keep the app running.
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
 * Enumerates installed fonts. On desktop the shell's fontdb index is used;
 * browsers need the Local Font Access API (Chromium). Only the `families`
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
    /** Renderer palette for the current workspace theme. */
    themeColors: ThemeColors;
  },
): void {
  typstState.setFont(configId, settings.font);
  typstState.setMathFont(configId, settings.mathFont);
  typstState.setCodeFont(configId, settings.codeFont);
  typstState.setTextSize(configId, settings.textSize);
  // Rendered pages follow the app theme: the palette derives from the same
  // tokens the chrome uses.
  typstState.setTheme(configId, settings.themeColors);
}

let workspaceConfigId: FileId | undefined;

/**
 * (Re)applies the workspace font settings to the wasm instance. Call after
 * settings change or once before opening the first page. Every page in a
 * workspace shares one space context, so one hidden file id is enough.
 */
export async function applyWorkspaceStyleToTypst(
  workspaceId: string,
  store: { getSettings(): WorkspaceSettings },
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

  workspaceConfigId ??= typstState.createSourceId("typbase-config", workspaceId);
  applyWorkspaceStyle(typstState, workspaceConfigId, {
    font: settings.font,
    mathFont: settings.mathFont,
    codeFont: settings.codeFont,
    textSize: settings.textSize,
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
