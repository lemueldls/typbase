import type { FlattenedBlock } from "@typbase/engine";

/** UTF-8 byte length of one Unicode code point. */
export function utf8LengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;

  return 4;
}

/** The UTF-8 byte offset of each UTF-16 index in the source, plus an end sentinel. */
export function utf16ByteOffsets(sourceText: string): Uint32Array {
  const out = new Uint32Array(sourceText.length + 1);
  let bytes = 0;

  for (let index = 0; index < sourceText.length;) {
    const codePoint = sourceText.codePointAt(index);
    if (codePoint === undefined) break;

    const units = codePoint > 0xffff ? 2 : 1;
    out[index] = bytes;
    if (units === 2) out[index + 1] = bytes;
    bytes += utf8LengthOfCodePoint(codePoint);
    index += units;
  }

  out[sourceText.length] = bytes;

  return out;
}

/**
 * Converts a block's byte map to raw UTF-16 offsets.
 *
 * `FlattenedBlock.map` has one entry per plain byte and each value is a raw
 * source byte offset. The result keeps the same indexing but stores the raw
 * UTF-16 offset, which is what CodeMirror and the paged frames use. One extra
 * entry at the end is the block's raw UTF-16 end offset.
 *
 * Pass `byteOffsets` when converting several blocks from the same page. Without
 * it each block walks the whole source, which turns a long note into a
 * quadratic indexing pass.
 */
export function utf16MapForBlock(
  block: FlattenedBlock,
  sourceText: string,
  byteOffsets = utf16ByteOffsets(sourceText),
): Uint32Array {
  const out = new Uint32Array(block.map.length + 1);
  if (block.map.length === 0) return out;

  for (let entry = 0; entry < block.map.length; entry++) {
    out[entry] = utf16AtByte(byteOffsets, block.map[entry] ?? 0);
  }

  const lastStart = out[block.map.length - 1] ?? sourceText.length;
  const lastCodePoint = sourceText.codePointAt(lastStart);
  out[block.map.length] =
    lastCodePoint === undefined ? sourceText.length : lastStart + (lastCodePoint > 0xffff ? 2 : 1);

  return out;
}

/** The first UTF-16 index at or before a raw byte offset. */
function utf16AtByte(byteOffsets: Uint32Array, byteOffset: number): number {
  let low = 0;
  let high = byteOffsets.length - 1;

  while (low < high) {
    const middle = (low + high) >> 1;
    if ((byteOffsets[middle] ?? 0) < byteOffset) low = middle + 1;
    else high = middle;
  }

  return (byteOffsets[low] ?? 0) === byteOffset ? low : Math.max(0, low - 1);
}

/**
 * The raw UTF-16 end of the plain byte range that ends at `byteExclusive`.
 *
 * The block map stores the start of each plain byte's character. A match that
 * ends before skipped markup should stop at the last matched character, not at
 * the start of the next plain character.
 */
export function rawEndForByte(map: Uint32Array, sourceText: string, byteExclusive: number): number {
  if (byteExclusive <= 0) return 0;

  const lastStart = map[byteExclusive - 1] ?? sourceText.length;
  const codePoint = sourceText.codePointAt(lastStart);
  if (codePoint === undefined) return lastStart;

  return lastStart + (codePoint > 0xffff ? 2 : 1);
}

/**
 * Cheap content fingerprint for the index cache. Two 32-bit hashes plus the
 * length make an accidental match unlikely without reading the page again.
 */
export function contentHash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }

  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}:${text.length}`;
}

/** A string folded for case- and accent-insensitive matching. */
export interface FoldedText {
  /** Lowercase text with combining marks removed. */
  text: string;
  /** Original UTF-16 offset for each folded UTF-16 unit, plus a final sentinel. */
  map: number[];
}

/**
 * Folds text for search. The map keeps every folded unit tied to its original
 * index, so a match can be translated back after accents or composed
 * characters change the length.
 */
export function foldText(input: string): FoldedText {
  let text = "";
  const map: number[] = [];

  for (let index = 0; index < input.length;) {
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) break;

    const original = String.fromCodePoint(codePoint);
    const folded = original.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

    for (const char of folded) {
      for (let unit = 0; unit < char.length; unit++) map.push(index);
      text += char;
    }

    index += original.length;
  }

  map.push(input.length);

  return { text, map };
}
