import type { Text } from "@codemirror/state";

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * Engine-free syntax highlighting for Typst, used while the wasm engine is
 * down. It is a scanner, not a parser: it tracks comments, raw blocks,
 * strings, and math delimiters across lines and tags what it recognizes with
 * the same `typ-*` classes the wasm highlighter emits, so the theme applies
 * unchanged. Expression extents are guessed, so `#foo[bar] baz` colors `baz`
 * as code; that is the trade for never calling wasm.
 */

type Mode = "markup" | "code" | "math" | "raw" | "comment";

interface ScanState {
  mode: Mode;
  /** Mode to return to when the closing `$` arrives. */
  mathReturn: "markup" | "code";
  /** Backtick run length that closes the current raw block; 0 when not raw. */
  fence: number;
  /** Open bracket count in code, so `#let x = (\n...\n)` stays code. */
  depth: number;
}

const KEYWORDS = new Set([
  "and",
  "as",
  "auto",
  "break",
  "context",
  "continue",
  "else",
  "false",
  "for",
  "if",
  "import",
  "in",
  "include",
  "let",
  "none",
  "not",
  "or",
  "return",
  "set",
  "show",
  "true",
  "while",
]);

const IDENT = /^[A-Za-z_][\w-]*/;
/** Math identifiers cannot start with `_`, which is the attach operator. */
const MATH_IDENT = /^[A-Za-z][A-Za-z0-9-]*/;

function classForIdent(ident: string, rest: string): string {
  if (KEYWORDS.has(ident)) return "typ-key";
  if (/^\s*[([{]/.test(rest)) return "typ-func";

  return "typ-pol";
}

function runLength(text: string, from: number): number {
  let end = from;
  while (end < text.length && text[end] === "`") end += 1;

  return end - from;
}

/** Start of the first backtick run of at least `fence` at or after `from`. */
function findFence(text: string, fence: number, from: number): number {
  let index = text.indexOf("`", from);
  while (index >= 0) {
    const run = runLength(text, index);
    if (run >= fence) return index;
    index = text.indexOf("`", index + run);
  }

  return -1;
}

export const typstStaticHighlighting = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state.doc);
  },
  update(decorations, transaction) {
    if (transaction.docChanged) return buildDecorations(transaction.state.doc);

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const state: ScanState = { mode: "markup", mathReturn: "markup", fence: 0, depth: 0 };

  const add = (from: number, to: number, cls: string) => {
    if (to > from) builder.add(from, to, Decoration.mark({ class: cls }));
  };

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    scanLine(line.text, state, (from, to, cls) => add(line.from + from, line.from + to, cls));
  }

  return builder.finish();
}

type Emit = (from: number, to: number, cls: string) => void;

function scanLine(line: string, state: ScanState, emit: Emit): void {
  let i = 0;

  // Finish a construct the previous line left open.
  if (state.mode === "comment") {
    const close = line.indexOf("*/");
    if (close < 0) {
      emit(0, line.length, "typ-comment");

      return;
    }
    emit(0, close + 2, "typ-comment");
    state.mode = "markup";
    i = close + 2;
  } else if (state.mode === "raw") {
    const close = findFence(line, state.fence, 0);
    if (close < 0) {
      emit(0, line.length, "typ-raw");

      return;
    }
    const run = runLength(line, close);
    emit(0, close + run, "typ-raw");
    state.mode = "markup";
    state.fence = 0;
    i = close + run;
  } else if (state.mode === "code" && state.depth === 0) {
    state.mode = "markup";
  }

  if (state.mode === "markup" && i === 0) i = markupLineStart(line, emit);

  while (i < line.length) {
    if (state.mode === "markup") i = markupToken(line, i, state, emit);
    else if (state.mode === "code") i = codeToken(line, i, state, emit);
    else i = mathToken(line, i, state, emit);
  }

  // A code line that opened no bracket ends at the newline.
  if (state.mode === "code" && state.depth === 0) state.mode = "markup";
}

/** Headings, list markers, and term text, which only count at line start. */
function markupLineStart(line: string, emit: Emit): number {
  const indent = /^\s*/.exec(line)?.[0].length ?? 0;
  const rest = line.slice(indent);

  const heading = /^(=+)(\s|$)/.exec(rest);
  if (heading) {
    const level = Math.min(heading[1]!.length, 6);
    emit(indent, line.length, `typ-heading typ-heading-level-${level}`);

    return line.length;
  }

  const marker = /^([-+/]|\d+\.)(\s|$)/.exec(rest);
  if (marker) {
    const end = indent + marker[1]!.length;
    emit(indent, end, "typ-marker");

    // Term lists: `/ term: description`, the term is bold.
    if (marker[1] === "/") {
      const colon = line.indexOf(":", end + 1);
      if (colon > 0) {
        emit(end + 1, colon, "typ-term");

        return colon + 1;
      }
    }

    return end;
  }

  return indent;
}

function markupToken(line: string, i: number, state: ScanState, emit: Emit): number {
  const rest = line.slice(i);
  const ch = line[i]!;

  if (rest.startsWith("//")) {
    emit(i, line.length, "typ-comment");

    return line.length;
  }

  if (rest.startsWith("/*")) {
    const close = line.indexOf("*/", i + 2);
    if (close < 0) {
      emit(i, line.length, "typ-comment");
      state.mode = "comment";

      return line.length;
    }
    emit(i, close + 2, "typ-comment");

    return close + 2;
  }

  if (ch === "`") {
    const run = runLength(line, i);
    const close = findFence(line, run, i + run);
    if (close < 0) {
      // Inline raw runs to the end of the line; a fenced block continues.
      emit(i + run, line.length, "typ-raw");
      if (run >= 3) {
        state.mode = "raw";
        state.fence = run;
      }

      return line.length;
    }
    emit(i + run, close, "typ-raw");

    return close + runLength(line, close);
  }

  if (ch === "$") {
    emit(i, i + 1, "typ-math-delim");
    state.mode = "math";
    state.mathReturn = "markup";

    return i + 1;
  }

  if (ch === "#") {
    const ident = IDENT.exec(line.slice(i + 1));
    if (ident) {
      const end = i + 1 + ident[0].length;
      emit(i, end, classForIdent(ident[0], line.slice(end)));
      if (KEYWORDS.has(ident[0])) {
        // `#let`, `#show`, ... take the rest of the line as code.
        state.mode = "code";
        state.depth = 0;
      }

      return end;
    }
    emit(i, i + 1, "typ-punct");

    return i + 1;
  }

  if (ch === "<") {
    const label = /^<[A-Za-z_][\w:.-]*>/.exec(rest);
    if (label) {
      emit(i, i + label[0].length, "typ-label");

      return i + label[0].length;
    }
  }

  if (ch === "@") {
    const ref = /^@[\w:.-]+/.exec(rest);
    if (ref) {
      emit(i, i + ref[0].length, "typ-ref");

      return i + ref[0].length;
    }
  }

  if (ch === "\\") {
    emit(i, Math.min(i + 2, line.length), "typ-escape");

    return i + 2;
  }

  if (ch === "*" || ch === "_") {
    const before = i === 0 ? "" : line[i - 1]!;
    const close = line.indexOf(ch, i + 1);
    const after = close < 0 ? "" : (line[close + 1] ?? "");
    if (
      close > i + 1 &&
      !/\w/.test(before) &&
      !/\s/.test(line[i + 1]!) &&
      !/\s/.test(line[close - 1]!) &&
      !/\w/.test(after)
    ) {
      emit(i, close + 1, ch === "*" ? "typ-strong" : "typ-emph");

      return close + 1;
    }
  }

  const link = /^(https?:\/\/|www\.)\S+/.exec(rest);
  if (link) {
    emit(i, i + link[0].length, "typ-link");

    return i + link[0].length;
  }

  return i + 1;
}

function codeToken(line: string, i: number, state: ScanState, emit: Emit): number {
  const rest = line.slice(i);
  const ch = line[i]!;

  if (rest.startsWith("//")) {
    emit(i, line.length, "typ-comment");

    return line.length;
  }

  if (rest.startsWith("/*")) {
    const close = line.indexOf("*/", i + 2);
    if (close < 0) {
      emit(i, line.length, "typ-comment");
      state.mode = "comment";

      return line.length;
    }
    emit(i, close + 2, "typ-comment");

    return close + 2;
  }

  if (ch === '"') {
    const end = stringEnd(line, i);
    emit(i, end, "typ-str");

    return end;
  }

  if (ch === "$") {
    emit(i, i + 1, "typ-math-delim");
    state.mode = "math";
    state.mathReturn = "code";

    return i + 1;
  }

  if (/[0-9]/.test(ch)) {
    const number = /^[0-9][\w.]*/.exec(rest)!;
    emit(i, i + number[0].length, "typ-num");

    return i + number[0].length;
  }

  if (/[A-Za-z_]/.test(ch)) {
    const ident = IDENT.exec(rest)!;
    emit(i, i + ident[0].length, classForIdent(ident[0], line.slice(i + ident[0].length)));

    return i + ident[0].length;
  }

  if ("([{".includes(ch)) {
    state.depth += 1;
    emit(i, i + 1, "typ-punct");

    return i + 1;
  }

  if (")]}".includes(ch)) {
    state.depth = Math.max(0, state.depth - 1);
    emit(i, i + 1, "typ-punct");

    return i + 1;
  }

  if (".,;:".includes(ch)) {
    emit(i, i + 1, "typ-punct");

    return i + 1;
  }

  const operator = /^(==|!=|<=|>=|=>|\.\.\.|\.\.|[+\-*/=!<>&|])/.exec(rest);
  if (operator) {
    emit(i, i + operator[0].length, "typ-op");

    return i + operator[0].length;
  }

  return i + 1;
}

function mathToken(line: string, i: number, state: ScanState, emit: Emit): number {
  const rest = line.slice(i);
  const ch = line[i]!;

  if (ch === "$") {
    emit(i, i + 1, "typ-math-delim");
    state.mode = state.mathReturn;

    return i + 1;
  }

  if (ch === '"') {
    const end = stringEnd(line, i);
    emit(i, end, "typ-str");

    return end;
  }

  if (/[0-9]/.test(ch)) {
    const number = /^[0-9][\w.]*/.exec(rest)!;
    emit(i, i + number[0].length, "typ-num");

    return i + number[0].length;
  }

  if (/[A-Za-z_]/.test(ch)) {
    const ident = MATH_IDENT.exec(rest);
    if (ident) {
      emit(i, i + ident[0].length, classForIdent(ident[0], line.slice(i + ident[0].length)));

      return i + ident[0].length;
    }
  }

  if (ch === "(" || ch === ")") {
    emit(i, i + 1, "typ-math-group");

    return i + 1;
  }

  if ("[]{}.,;:".includes(ch)) {
    emit(i, i + 1, "typ-punct");

    return i + 1;
  }

  if ("^_&/".includes(ch)) {
    emit(i, i + 1, "typ-math-op");

    return i + 1;
  }

  if ("+-*=<>.!|".includes(ch)) {
    emit(i, i + 1, "typ-op");

    return i + 1;
  }

  return i + 1;
}

/** End of a string literal starting at `from`, or the line end. */
function stringEnd(line: string, from: number): number {
  let index = from + 1;
  while (index < line.length) {
    if (line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line[index] === '"') return index + 1;
    index += 1;
  }

  return line.length;
}
