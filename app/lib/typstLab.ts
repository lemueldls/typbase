import type { TypstRequest, TypstState } from "@typbase/wasm";

import { createTypstRequestService } from "./typstRequests";

export interface CompileReport {
  source: string;
  frames: unknown[];
  diagnostics: Array<{
    message: string;
    severity: string;
    range: { start: number; end: number };
    hints: string[];
  }>;
  requests: TypstRequest[];
  resolvedRequests: TypstRequest[];
  durationMs: number;
}

/**
 * Compiles an arbitrary Typst snippet against the live workspace through the
 * same request channel the editor uses. Each run gets a throwaway source id
 * that is removed afterwards, so the lab never pollutes real pages.
 */
export async function compileForLab(
  typstState: TypstState,
  store: {
    getSettings(): {
      font: string;
      mathFont: string | null;
      codeFont: string | null;
    };
  },
  spaceId: string,
  source: string,
): Promise<CompileReport> {
  const service = createTypstRequestService(typstState, store as never);
  const id = typstState.createSourceId("debug-lab", spaceId);
  typstState.insertSource(id, source);

  const t0 = performance.now();
  let result = typstState.compilePaged(id, source, "");
  const resolvedRequests: TypstRequest[] = [];

  while (result.requests.length > 0) {
    resolvedRequests.push(...result.requests);
    const updated = await service.handler(result.requests, spaceId);
    if (!updated) break;
    result = typstState.compilePaged(id, source, "");
  }

  const durationMs = performance.now() - t0;

  typstState.removeFile(id);
  service.purge();

  return {
    source,
    frames: result.frames as unknown[],
    diagnostics: result.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      severity: String(diagnostic.severity),
      range: { start: diagnostic.range.start, end: diagnostic.range.end },
      hints: [...diagnostic.hints],
    })),
    requests: result.requests,
    resolvedRequests,
    durationMs,
  };
}

export interface CapturedLog {
  level: "log" | "error" | "warn" | "debug" | "info";
  line: string;
}

export interface CheckedSegment {
  kind: string;
  generated: boolean;
  from: number;
  from_end: number;
  to: number;
  to_end: number;
}

/** Runs the wasm source-map self-check over a synthesized source. */
export async function runIndexCheck(
  typstState: TypstState,
  spaceId: string,
  source: string,
): Promise<{ ok: boolean; checked: number; mismatches: string[]; segments: CheckedSegment[] }> {
  const id = typstState.createSourceId("debug-lab", spaceId);
  typstState.insertSource(id, source);
  const report = typstState.checkIndex(id, source, "");
  typstState.removeFile(id);

  return report;
}

export interface CaseResult {
  id: string;
  label: string;
  crash: string | null;
  frames: number;
  diagnostics: number;
  issues: string[];
}

export interface RecoveryCase {
  id: string;
  label: string;
  source: string;
}

/**
 * Built-in recovery cases. Each runs through the real compile pipeline
 * (with the workspace request channel) and is then validated.
 */
export const RECOVERY_CASES: RecoveryCase[] = [
  {
    id: "for-loop-query",
    label: "for-loop + query + list",
    source: [
      "= List",
      "",
      '#let pages = typbase.query("pages")',
      "",
      "#for page in pages [",
      "  - #page.title (#page.path)",
      "]",
    ].join("\n"),
  },
  {
    id: "math-broken",
    label: "broken math",
    source: "= Math\n\n$x^ + y$ and $integral_0^1 dif x$",
  },
  {
    id: "unknown-var",
    label: "unknown variable",
    source: "= Oops\n\n#missing-value\n\nstill here",
  },
  {
    id: "syntax-error",
    label: "syntax error",
    source: "= Syntax\n\n#let bad = (\n\n- item",
  },
  {
    id: "missing-query",
    label: "unknown query kind",
    source: '= Query\n\n#typbase.query("nope")',
  },
  {
    id: "self-embed",
    label: "embed self (cycle guard)",
    source: '= Embed\n\n#typbase.embed("debug-lab")',
  },
  {
    id: "unclosed-for",
    label: "unclosed for bracket (mid-typing state)",
    source: '#let pages = typbase.query("pages")\n\n#for page in pages [\n  - #page.title\n',
  },
  {
    id: "half-query-line",
    label: "half-typed query line",
    source: '#let pages = typbase.query("',
  },
  {
    id: "block-heavy",
    label: "block-heavy (300 paragraphs)",
    source: Array.from({ length: 300 }, (_, i) => `Paragraph ${i} with *some* text.`).join("\n\n"),
  },
];

/**
 * Simulates typing by compiling every prefix of `source`, like the editor
 * does per keystroke. Reports wasm heap growth so leaks in the compile
 * pipeline show up without the editor shell involved.
 */
export async function typingSimulation(
  typstState: TypstState,
  store: {
    getSettings(): {
      font: string;
      mathFont: string | null;
      codeFont: string | null;
    };
  },
  spaceId: string,
  source: string,
): Promise<{
  prefixes: number;
  crashes: string | null;
  wasmStartMB: number;
  wasmEndMB: number;
}> {
  const start = typstState.memoryBytes();
  let crashes: string | null = null;
  let prefixes = 0;

  try {
    for (let end = 1; end <= source.length; end++) {
      // Compile at every character; each round at least compiles once.
      await compileForLab(typstState, store as never, spaceId, source.slice(0, end));
      prefixes++;
    }
  } catch (reason) {
    crashes = reason instanceof Error ? reason.message : String(reason);
  }

  const endBytes = typstState.memoryBytes();

  return {
    prefixes,
    crashes,
    wasmStartMB: Math.round(start / 1e6),
    wasmEndMB: Math.round(endBytes / 1e6),
  };
}

/** Validates a compiled report against the source it was compiled from. */
export function validateReport(report: CompileReport, source: string): string[] {
  const issues: string[] = [];
  const utf16Len = source.length;

  let lastStart = -1;
  for (const frame of report.frames as Array<{
    range: { start: number; end: number };
  }>) {
    const { start, end } = frame.range;
    if (start < 0 || end > utf16Len || start > end) {
      issues.push(`frame range out of bounds: ${start}..${end} (doc ${utf16Len})`);
    }
    if (start < lastStart) {
      issues.push(`frame range regressed: ${start} < ${lastStart}`);
    }
    lastStart = start;
  }

  return issues;
}

/** Wraps console methods so wasm `crate::log!` traffic shows in the lab. */
export function captureConsole() {
  const captured: CapturedLog[] = [];
  const levels = ["log", "error", "warn", "debug", "info"] as const;

  const wraps = levels.map((level) => {
    const original = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      captured.push({ level, line: args.map(String).join(" ") });
      original(...args);
    }) as unknown as (typeof console)[typeof level];

    return { level, original };
  });

  return {
    captured,
    restore() {
      for (const { level, original } of wraps) {
        console[level] = original;
      }
    },
  };
}
