import type { TypstDiagnostic, TypstState } from "@typbase/engine";

import { TypstState as TypstStateClass } from "@typbase/engine";

import type { ExportFile } from "~/lib/exportPage";

import { getTypstFontImports } from "~/composables/typst";

/** Extensions a compile can read as text. Anything else is not compilable. */
const TEXT = new Set([".typ", ".json", ".toml", ".tmtheme", ".css", ".html", ".svg", ".md"]);

export interface BundleTextFile {
  name: string;
  text: string;
}

export interface BundleCheckResult {
  /** Messages from error-severity diagnostics. */
  errors: string[];
  /** Request paths the compile wanted and the bundle did not carry. */
  missing: string[];
  /** Whether the entry file was in the bundle at all. */
  foundEntry: boolean;
}

/** The bundle's readable files, for handing to a compile. */
export function bundleTextFiles(files: ExportFile[]): BundleTextFile[] {
  const decoder = new TextDecoder();
  const out: BundleTextFile[] = [];

  for (const file of files) {
    const dot = file.name.lastIndexOf(".");
    const extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
    if (!TEXT.has(extension)) continue;
    out.push({ name: file.name, text: decoder.decode(file.bytes) });
  }

  return out;
}

async function withFonts<T>(use: (state: TypstState) => Promise<T>): Promise<T> {
  const state = new TypstStateClass();
  for (const fontImports of getTypstFontImports()) {
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(
      fontImports.map(async (fontImport) => {
        const { default: url } = await fontImport;
        const response = await fetch(url);
        state.installFont(new Uint8Array(await response.arrayBuffer()));
      }),
    );
  }

  return use(state);
}

/**
 * Compiles `entry` with only the bundle's files in the world. The exported
 * source already carries the prelude inline, so the prelude argument is empty.
 */
export async function compileBundle(
  files: BundleTextFile[],
  entry: string,
  spaceId: string,
): Promise<BundleCheckResult> {
  const source = files.find((file) => file.name === entry);
  if (!source) return { errors: [], missing: [], foundEntry: false };

  return withFonts(async (state) => {
    // `createFileId`, not `createSourceId`: the latter forces a `.typ`
    // extension, which would rewrite `plugin-data/<id>.json` to `.typ` and leave
    // the compile asking for a file that is not there. This is the same call the
    // request service makes for every resolved payload.
    for (const file of files) {
      if (file.name === entry) continue;
      state.insertSource(state.createFileId(file.name), file.text);
    }

    // The entry alone needs a SourceContext, because renderHtml goes through the
    // raw/synth pipeline.
    const id = state.createSourceId(entry, spaceId);
    state.insertSource(id, source.text);
    const rendered = state.renderHtml(id, source.text, "");

    return {
      errors: rendered.diagnostics
        .filter((diagnostic: TypstDiagnostic) => diagnostic.severity === "error")
        .map((diagnostic: TypstDiagnostic) => diagnostic.message),
      missing: rendered.requests.map((request) => String(request.value)),
      foundEntry: true,
    };
  });
}
