import type { Diagnostic } from "@codemirror/lint";
import type { FileId, TypstDiagnostic, TypstState } from "@typbase/wasm";

import { linter } from "@codemirror/lint";

import type { TextRef, TypstRequestHandler } from "./types";

import { parseBackticks } from "./highlight";

/**
 * Latest Typst diagnostics per page path. The WYSIWYG plugin caches the
 * diagnostics of every compile here, so the linter source can reuse them
 * instead of compiling the same text a second time.
 */
const diagnosticsCache = new Map<string, { text: string; diagnostics: TypstDiagnostic[] }>();

export function rememberDiagnostics(
  path: string,
  text: string,
  diagnostics: TypstDiagnostic[],
): void {
  diagnosticsCache.set(path, { text, diagnostics });
}

function cachedDiagnostics(path: string, text: string): TypstDiagnostic[] | undefined {
  const entry = diagnosticsCache.get(path);

  return entry && entry.text === text ? entry.diagnostics : undefined;
}

/** Converts engine diagnostics into CodeMirror lint diagnostics. */
export function toLintDiagnostics(typstDiagnostics: TypstDiagnostic[]): Diagnostic[] {
  return typstDiagnostics.map((diagnostic) => ({
    from: diagnostic.range.start,
    to: diagnostic.range.end,
    severity: diagnostic.severity,
    message: diagnostic.message,
    renderMessage() {
      const fragment = document.createDocumentFragment();
      const paragraph = document.createElement("p");
      parseBackticks(diagnostic.message, paragraph);
      fragment.append(paragraph);

      if (diagnostic.hints.length) {
        const list = document.createElement("ul");
        list.className = "typst-hints";

        for (const hint of diagnostic.hints) {
          const item = document.createElement("li");
          parseBackticks(hint, item);
          list.append(item);
        }

        fragment.append(list);
      }

      return fragment;
    },
  }));
}

export interface TypstLinterOptions {
  onRequests?: TypstRequestHandler;
  onPanic?: (fileId: FileId) => void;
  /** Called after a diagnostics compile succeeds. */
  onCompile?: () => void;
}

/**
 * Typst diagnostics as a CodeMirror linter source.
 *
 * This runs in every editor mode and combines with other sources (the
 * spellcheck linter), so neither one replaces the other. The WYSIWYG plugin's
 * compile feeds the cache; split and source mode fall back to a compile here
 * so they get diagnostics too.
 */
export const typstLinter = (
  fileId: FileId,
  spaceId: string,
  path: string,
  prelude: TextRef,
  typstState: TypstState,
  options: TypstLinterOptions = {},
) =>
  linter(
    async (view) => {
      const text = view.state.doc.toString();
      const cached = cachedDiagnostics(path, text);
      if (cached) return toLintDiagnostics(cached);

      let result: ReturnType<TypstState["compilePaged"]>;
      try {
        result = typstState.compilePaged(fileId, text, prelude.value);
      } catch (error) {
        console.error("[typst] diagnostics compile panicked:", error);
        options.onPanic?.(fileId);

        return [];
      }

      if (result.requests.length > 0 && options.onRequests) {
        const updated = await options.onRequests(result.requests, spaceId);
        if (updated) result = typstState.compilePaged(fileId, text, prelude.value);
      }

      rememberDiagnostics(path, text, result.diagnostics);
      options.onCompile?.();

      return toLintDiagnostics(result.diagnostics);
    },
    { delay: 400 },
  );
