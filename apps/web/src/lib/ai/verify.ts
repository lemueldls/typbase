import type { TypstState } from "@typbase/engine";
import type { ChatDiagnostic } from "@typbase/typing";

import type { ProviderMessage } from "./providers";

import { repairMessages } from "./context";

/**
 * The acceptance gate. A reply counts as grounded only when the engine's
 * pristine compile (no delimiter repair, no error recovery) reports no
 * errors. Diagnostics come from the wasm engine already mapped to raw source
 * offsets; this module validates them and turns them into a repair prompt.
 */

export function toChatDiagnostics(raw: unknown[], source: string): ChatDiagnostic[] {
  const out: ChatDiagnostic[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const diagnostic = entry as {
      message?: unknown;
      severity?: unknown;
      range?: { start?: unknown; end?: unknown };
      hints?: unknown;
    };
    const start = typeof diagnostic.range?.start === "number" ? diagnostic.range.start : 0;
    const end = typeof diagnostic.range?.end === "number" ? diagnostic.range.end : start;
    out.push({
      severity: diagnostic.severity === "error" ? "error" : "warning",
      message: typeof diagnostic.message === "string" ? diagnostic.message : "compile problem",
      start: Math.max(0, Math.min(start, source.length)),
      end: Math.max(0, Math.min(end, source.length)),
      hints: Array.isArray(diagnostic.hints) ? diagnostic.hints.map(String) : [],
    });
  }

  return out;
}

export function hasErrors(diagnostics: ChatDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/** Line and column (1-based) for a UTF-16 offset in the source. */
export function lineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const limit = Math.max(0, Math.min(offset, source.length));

  for (let i = 0; i < limit; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }

  return { line, column: limit - lineStart + 1 };
}

/** Human-readable diagnostics for the repair prompt and the UI. */
export function formatDiagnostics(source: string, diagnostics: ChatDiagnostic[]): string {
  const lines: string[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") continue;
    const { line, column } = lineColumn(source, diagnostic.start);
    const lineEnd = source.indexOf("\n", Math.max(0, diagnostic.start));
    const text = source
      .slice(
        source.lastIndexOf("\n", Math.max(0, diagnostic.start - 1)) + 1,
        lineEnd === -1 ? undefined : lineEnd,
      )
      .trim()
      .slice(0, 160);
    lines.push(
      `- line ${line}:${column}: ${diagnostic.message}${text ? `\n  > ${text}` : ""}${
        diagnostic.hints.length ? `\n  hint: ${diagnostic.hints.join("; ")}` : ""
      }`,
    );
  }

  return lines.join("\n") || "- the document did not compile";
}

export function buildRepairPrompt(input: {
  typstState: TypstState;
  source: string;
  diagnostics: ChatDiagnostic[];
}): ProviderMessage[] {
  return repairMessages({
    typstState: input.typstState,
    source: input.source,
    diagnostics: formatDiagnostics(input.source, input.diagnostics),
  });
}

/** "2 errors, 1 warning" for status rows and toasts. */
export function summarizeDiagnostics(diagnostics: ChatDiagnostic[]): string {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);

  return parts.join(", ") || "no problems";
}
