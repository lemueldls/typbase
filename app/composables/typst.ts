import type { WorkspaceSettings } from "@typbase/typing";
import type { FileId, ThemeColors } from "@typbase/wasm";

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

/**
 * Installs the bundled fonts into a fresh TypstState. Used by useTypst and
 * by panic recovery, which needs a brand-new instance because a wasm abort
 * leaves the old one unusable.
 */
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

/**
 * Installs every system font into the wasm instance. Requires the Local Font
 * Access API (Chromium); `queryLocalFonts()` prompts for permission, so call
 * this from a click handler, not on load.
 */
export async function loadSystemFonts(typstState: TypstState): Promise<void> {
  if (!window.queryLocalFonts) {
    systemFontsError.value = "This browser does not support the Local Font Access API.";
    throw new Error(systemFontsError.value);
  }

  systemFontsLoading.value = true;
  systemFontsError.value = null;

  try {
    const fonts = await window.queryLocalFonts();

    for (const font of fonts) {
      const blob = await font.blob();
      typstState.installFont(new Uint8Array(await blob.arrayBuffer()));
    }

    systemFontFamilies.value = [...new Set(fonts.map((font) => font.family))].sort();
    systemFontsLoaded.value = true;
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
    /** Renderer palette for the current workspace theme. */
    themeColors: ThemeColors;
  },
): void {
  typstState.setFont(configId, settings.font);
  typstState.setMathFont(configId, settings.mathFont);
  typstState.setCodeFont(configId, settings.codeFont);
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
): Promise<void> {
  const typstState = await useTypst();
  workspaceConfigId ??= typstState.createSourceId("typbase-config", workspaceId);
  const settings = store.getSettings();
  applyWorkspaceStyle(typstState, workspaceConfigId, {
    font: settings.font,
    mathFont: settings.mathFont,
    codeFont: settings.codeFont,
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
