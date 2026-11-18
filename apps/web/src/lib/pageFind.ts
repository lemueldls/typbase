import type { FrameText, FrameTextRun } from "@typbase/engine";

import { foldText, type FoldedText } from "~/lib/searchText";

/** One visible match rectangle, in frame points (CSS pixels here). */
export interface FindRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A raw UTF-16 range in the page source. */
export interface SourceRange {
  from: number;
  to: number;
}

/** A match's rectangles inside one frame. */
export interface FindMark {
  frameIndex: number;
  range: SourceRange;
  rects: FindRect[];
}

/** One find result, in both source and rendered coordinates when available. */
export interface FindHit {
  source: SourceRange | null;
  marks: FindMark[];
}

/** Ceiling for one page, so a one-character query cannot build a huge list. */
export const MAX_PAGE_MATCHES = 1000;

interface GlyphBox {
  source: SourceRange | null;
  rect: FindRect;
}

interface PreparedFrame {
  frameIndex: number;
  range: SourceRange;
  text: string;
  /** Glyph index for each UTF-16 unit of `text`, or -1 for separators. */
  glyphForUnit: number[];
  glyphs: GlyphBox[];
}

interface SourceSpan extends SourceRange {
  frameIndex: number;
  glyph: number;
}

/** A frame text index prepared for query passes. */
export interface PreparedPage {
  frames: PreparedFrame[];
  /** Visible text of every frame, in order, joined by a space. */
  text: string;
  folded: FoldedText;
  /** Frame index for each UTF-16 unit of `text`, or -1 for separators. */
  frameForUnit: number[];
  /** Glyph index inside that frame for each unit, or -1. */
  glyphForUnit: number[];
  sourceSpans: SourceSpan[];
}

/** FNV-1a over UTF-8 bytes, matching the engine's `source_hash`. */
export function sourceHash(text: string): number {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/**
 * Turns the engine's frame text into searchable text and glyph boxes.
 *
 * Runs are joined with a space when the layout moved to a new line or left a
 * visible gap. Separators have no box, so they widen a match without drawing a
 * highlight of their own.
 */
export function prepareFrameText(frames: FrameText | null | undefined): PreparedPage {
  const prepared: PreparedFrame[] = [];
  const sourceSpans: SourceSpan[] = [];

  for (const [frameIndex, frame] of (frames?.frames ?? []).entries()) {
    const glyphs: GlyphBox[] = [];
    const glyphForUnit: number[] = [];
    let text = "";
    let lastWasSpace = true;
    let previousEndX: number | null = null;
    let previousY: number | null = null;

    for (const run of frame.runs) {
      if (!run.text || run.glyphs.length === 0) continue;
      if (!Number.isFinite(run.x) || !Number.isFinite(run.y) || !Number.isFinite(run.height)) {
        continue;
      }

      if (text && !lastWasSpace && previousEndX !== null && previousY !== null) {
        const lineChanged = Math.abs(run.y - previousY) > Math.max(1, run.height * 0.5);
        if (lineChanged || run.x - previousEndX > 0.5) {
          text += " ";
          glyphForUnit.push(-1);
          lastWasSpace = true;
        }
      }

      const runGlyphs = addRunGlyphs(run, frameIndex, glyphs, sourceSpans);
      for (const entry of runGlyphs) {
        for (let unit = 0; unit < entry.text.length; unit++) {
          const char = entry.text[unit]!;
          if (/\s/u.test(char)) {
            if (!lastWasSpace) {
              text += " ";
              glyphForUnit.push(-1);
              lastWasSpace = true;
            }
          } else {
            text += char;
            glyphForUnit.push(entry.glyph);
            lastWasSpace = false;
          }
        }
      }

      const lastRect = runGlyphs.at(-1)?.rect;
      previousEndX = lastRect ? lastRect.x + lastRect.width : null;
      previousY = run.y;
    }

    prepared.push({
      frameIndex,
      range: { from: frame.from, to: frame.to },
      text,
      glyphForUnit,
      glyphs,
    });
  }

  let text = "";
  const frameForUnit: number[] = [];
  const glyphForUnit: number[] = [];

  for (const frame of prepared) {
    if (!frame.text) continue;

    if (text && !text.endsWith(" ")) {
      text += " ";
      frameForUnit.push(-1);
      glyphForUnit.push(-1);
    }

    text += frame.text;
    for (let unit = 0; unit < frame.text.length; unit++) {
      frameForUnit.push(frame.frameIndex);
      glyphForUnit.push(frame.glyphForUnit[unit] ?? -1);
    }
  }

  return {
    frames: prepared,
    text,
    folded: foldText(text),
    frameForUnit,
    glyphForUnit,
    sourceSpans,
  };
}

function addRunGlyphs(
  run: FrameTextRun,
  frameIndex: number,
  glyphs: GlyphBox[],
  sourceSpans: SourceSpan[],
): Array<{ text: string; glyph: number; rect: FindRect }> {
  const entries: Array<{ text: string; glyph: number; rect: FindRect }> = [];

  for (const glyph of run.glyphs) {
    const start = Math.max(0, Math.min(glyph.start, run.text.length));
    const end = Math.max(start, Math.min(glyph.end, run.text.length));
    if (end <= start) continue;

    const rect: FindRect = {
      x: glyph.x,
      y: run.y,
      width: Math.max(0, glyph.width),
      height: run.height,
    };
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.width)) continue;

    const source =
      glyph.from !== undefined && glyph.to !== undefined && glyph.to > glyph.from
        ? { from: glyph.from, to: glyph.to }
        : null;
    const index = glyphs.length;
    glyphs.push({ source, rect });
    if (source) sourceSpans.push({ ...source, frameIndex, glyph: index });

    entries.push({ text: run.text.slice(start, end), glyph: index, rect });
  }

  return entries;
}

/** Search options shared by matching and replacement. */
export interface FindOptions {
  matchCase: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  matchCase: false,
  regexp: false,
  wholeWord: false,
};

/** Case- and accent-insensitive matches in rendered frame text. */
export function findInPage(
  page: PreparedPage,
  query: string,
  options: FindOptions = DEFAULT_FIND_OPTIONS,
  limit = MAX_PAGE_MATCHES,
): FindHit[] {
  const hits: FindHit[] = [];

  for (const range of matchRanges(page.text, page.folded, query, options, limit)) {
    const byFrame = new Map<number, { range: SourceRange; rects: FindRect[] }>();
    let source: SourceRange | null = null;

    for (let unit = range.from; unit < range.to; unit++) {
      const frameIndex = page.frameForUnit[unit];
      const glyphIndex = page.glyphForUnit[unit];
      if (
        frameIndex === undefined ||
        frameIndex < 0 ||
        glyphIndex === undefined ||
        glyphIndex < 0
      ) {
        continue;
      }

      const frame = page.frames[frameIndex];
      const glyph = frame?.glyphs[glyphIndex];
      if (!frame || !glyph) continue;

      const entry = byFrame.get(frameIndex) ?? { range: frame.range, rects: [] };
      entry.rects.push(glyph.rect);
      byFrame.set(frameIndex, entry);

      if (glyph.source) {
        source = source
          ? {
              from: Math.min(source.from, glyph.source.from),
              to: Math.max(source.to, glyph.source.to),
            }
          : { ...glyph.source };
      }
    }

    if (byFrame.size > 0 || source) {
      hits.push({
        source,
        marks: Array.from(byFrame, ([frameIndex, entry]) => ({
          frameIndex,
          range: entry.range,
          rects: mergeRects(entry.rects),
        })),
      });
    }
  }

  return hits;
}

/** A raw source text and its folded form, reused across query keystrokes. */
export interface PreparedSource {
  text: string;
  folded: FoldedText;
}

/** Folds raw source once, so typing in the find bar does not refold it. */
export function prepareSourceText(text: string): PreparedSource {
  return { text, folded: foldText(text) };
}

/** Case- and accent-insensitive matches in the raw page source. */
export function findInSource(
  page: PreparedPage,
  source: PreparedSource,
  query: string,
  options: FindOptions = DEFAULT_FIND_OPTIONS,
  limit = MAX_PAGE_MATCHES,
): FindHit[] {
  return matchRanges(source.text, source.folded, query, options, limit).map((range) => ({
    source: range,
    marks: marksForSource(page, range.from, range.to),
  }));
}

function matchRanges(
  text: string,
  folded: FoldedText,
  query: string,
  options: FindOptions,
  limit: number,
): SourceRange[] {
  if (!query.trim()) return [];

  return options.regexp
    ? regexRanges(text, query, options, limit)
    : literalRanges(text, folded, query, options, limit);
}

function literalRanges(
  text: string,
  folded: FoldedText,
  query: string,
  options: FindOptions,
  limit: number,
): SourceRange[] {
  const ranges: SourceRange[] = [];

  if (options.matchCase) {
    let cursor = 0;

    while (ranges.length < limit) {
      const at = text.indexOf(query, cursor);
      if (at < 0) break;

      const range = { from: at, to: at + query.length };
      if (!options.wholeWord || wholeWord(text, range)) ranges.push(range);

      cursor = at + Math.max(1, query.length);
    }

    return ranges;
  }

  const needle = foldText(query).text;
  if (!needle) return [];

  let cursor = 0;

  while (ranges.length < limit) {
    const at = folded.text.indexOf(needle, cursor);
    if (at < 0) break;

    const range = foldedRange(folded, text, at, needle.length);
    if (!options.wholeWord || wholeWord(text, range)) ranges.push(range);

    cursor = at + Math.max(1, needle.length);
  }

  return ranges;
}

function regexRanges(
  text: string,
  query: string,
  options: FindOptions,
  limit: number,
): SourceRange[] {
  const ranges: SourceRange[] = [];

  let regex: RegExp;
  try {
    regex = new RegExp(query, regexFlags(options));
  } catch {
    return ranges;
  }

  let match: RegExpExecArray | null;

  while (ranges.length < limit && (match = regex.exec(text))) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }

    const range = { from: match.index, to: match.index + match[0].length };
    if (!options.wholeWord || wholeWord(text, range)) ranges.push(range);
  }

  return ranges;
}

function regexFlags(options: FindOptions): string {
  return options.matchCase ? "gm" : "gim";
}

/** False when regexp mode has a pattern the browser cannot compile. */
export function isValidPattern(query: string, options: FindOptions): boolean {
  if (!options.regexp || !query.trim()) return true;

  try {
    RegExp(query, regexFlags(options));
    return true;
  } catch {
    return false;
  }
}

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;

function wholeWord(text: string, range: SourceRange): boolean {
  return !wordBefore(text, range.from) && !wordAt(text, range.to);
}

function wordBefore(text: string, index: number): boolean {
  if (index <= 0) return false;

  let start = index - 1;
  const unit = text.charCodeAt(start);
  if (unit >= 0xdc00 && unit <= 0xdfff && start > 0) start -= 1;

  return wordAt(text, start);
}

function wordAt(text: string, index: number): boolean {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) return false;

  return WORD_CHARACTER.test(String.fromCodePoint(codePoint));
}

/** The replacement for one hit, expanding `$1` and friends for regexp mode. */
export function replacementFor(
  text: string,
  hit: FindHit,
  query: string,
  replacement: string,
  options: FindOptions,
): string {
  if (!options.regexp || !hit.source) return replacement;

  const match = regexMatchAt(text, hit.source.from, query, options);
  return match ? expandReplacement(replacement, match, text) : replacement;
}

function regexMatchAt(
  text: string,
  from: number,
  query: string,
  options: FindOptions,
): RegExpExecArray | null {
  let regex: RegExp;
  try {
    regex = new RegExp(query, regexFlags(options));
  } catch {
    return null;
  }

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (match.index === from) return match;
    if (match.index > from) return null;
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  return null;
}

function expandReplacement(replacement: string, match: RegExpExecArray, text: string): string {
  return replacement.replace(/\$(\$|&|`|'|\d{1,2})/g, (_token, group: string) => {
    if (group === "$") return "$";
    if (group === "&") return match[0];
    if (group === "`") return text.slice(0, match.index);
    if (group === "'") return text.slice(match.index + match[0].length);

    const capture = Number(group);
    if (capture === 0) return match[0];

    return match[capture] ?? "";
  });
}

/**
 * Combines source and rendered passes into one list.
 *
 * A source hit and a page hit for the same occurrence usually carry the same
 * source range. Merging them keeps one count and puts both the source
 * selection and the rendered rectangles on the same result.
 */
export function mergeFindHits(sourceHits: FindHit[], pageHits: FindHit[]): FindHit[] {
  const bySource = new Map<string, FindHit>();
  const hits: FindHit[] = [];

  const add = (hit: FindHit) => {
    if (hit.source) {
      const key = `${hit.source.from}:${hit.source.to}`;
      const existing = bySource.get(key);
      if (existing) {
        existing.marks = mergeMarks(existing.marks, hit.marks);
        return;
      }

      bySource.set(key, hit);
    }

    hits.push(hit);
  };

  for (const hit of sourceHits) add(hit);
  for (const hit of pageHits) add(hit);

  hits.sort((left, right) => hitStart(left) - hitStart(right));

  return hits;
}

function hitStart(hit: FindHit): number {
  return hit.source?.from ?? hit.marks[0]?.range.from ?? 0;
}

function mergeMarks(left: FindMark[], right: FindMark[]): FindMark[] {
  const byFrame = new Map<string, FindMark>();

  for (const mark of [...left, ...right]) {
    const key = `${mark.frameIndex}:${mark.range.from}:${mark.range.to}`;
    const existing = byFrame.get(key);
    if (existing) {
      existing.rects = mergeRects([...existing.rects, ...mark.rects]);
    } else {
      byFrame.set(key, { ...mark, rects: mergeRects(mark.rects) });
    }
  }

  return Array.from(byFrame.values());
}

/** Rectangles for every visible glyph whose source range overlaps `from..to`. */
export function marksForSource(page: PreparedPage, from: number, to: number): FindMark[] {
  if (to <= from) return [];

  const byFrame = new Map<number, { range: SourceRange; rects: FindRect[] }>();

  for (const span of page.sourceSpans) {
    if (span.to <= from || span.from >= to) continue;

    const frame = page.frames[span.frameIndex];
    if (!frame) continue;

    const entry = byFrame.get(span.frameIndex) ?? { range: frame.range, rects: [] };
    const rect = frame.glyphs[span.glyph]?.rect;
    if (rect) entry.rects.push(rect);
    byFrame.set(span.frameIndex, entry);
  }

  return Array.from(byFrame, ([frameIndex, entry]) => ({
    frameIndex,
    range: entry.range,
    rects: mergeRects(entry.rects),
  }));
}

function foldedRange(folded: FoldedText, text: string, at: number, length: number): SourceRange {
  const from = folded.map[at] ?? text.length;
  let to = folded.map[at + length] ?? text.length;

  // A folded match can end inside one original character, for example when an
  // accent was stripped. Stop after that character instead of returning an
  // empty range.
  if (to <= from) {
    const codePoint = text.codePointAt(from);
    to = from + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
  }

  return { from, to: Math.min(to, text.length) };
}

/**
 * Joins glyph boxes that touch on the same line. A phrase becomes one rectangle
 * per line instead of one per glyph.
 */
export function mergeRects(rects: FindRect[]): FindRect[] {
  if (rects.length < 2) return rects.map((rect) => ({ ...rect }));

  const sorted = rects.slice().sort((left, right) => left.y - right.y || left.x - right.x);
  const merged: FindRect[] = [];

  for (const rect of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      Math.abs(last.y - rect.y) < 0.75 &&
      Math.abs(last.height - rect.height) < 0.75 &&
      rect.x <= last.x + last.width + 0.5
    ) {
      const end = Math.max(last.x + last.width, rect.x + rect.width);
      last.x = Math.min(last.x, rect.x);
      last.width = end - last.x;
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
}
