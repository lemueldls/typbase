import type { FlattenedBlock } from "@typbase/engine";

import {
  foldText,
  rawEndForByte,
  utf8LengthOfCodePoint,
  utf16ByteOffsets,
  utf16MapForBlock,
  type FoldedText,
} from "~/lib/searchText";

/** One match in the open page, in raw UTF-16 offsets. */
export interface PageMatch {
  blockIndex: number;
  from: number;
  to: number;
}

/** A block with the lookup tables a find pass needs. */
export interface PreparedPageBlock {
  block: FlattenedBlock;
  /** Folded plain text plus the map back to the original plain string. */
  folded: FoldedText;
  /** Plain UTF-16 index to plain byte offset. */
  plainBytes: Uint32Array;
  /** Plain byte offset to raw UTF-16 offset. */
  rawMap: Uint32Array;
}

/** Ceiling for one page, so a one-character query cannot build a huge list. */
export const MAX_PAGE_MATCHES = 1000;

/**
 * Builds the tables once per page text. The find bar then searches on each
 * keystroke without parsing or rescanning the source.
 */
export function preparePageBlocks(
  blocks: FlattenedBlock[],
  sourceText: string,
): PreparedPageBlock[] {
  const byteOffsets = utf16ByteOffsets(sourceText);

  return blocks.map((block) => ({
    block,
    folded: foldText(block.plain),
    plainBytes: utf16ToByteOffsets(block.plain),
    rawMap: utf16MapForBlock(block, sourceText, byteOffsets),
  }));
}

/** Case- and accent-insensitive substring matches in the prepared page. */
export function findInPrepared(
  prepared: PreparedPageBlock[],
  query: string,
  sourceText: string,
  limit = MAX_PAGE_MATCHES,
): PageMatch[] {
  const needle = foldText(query).text;
  if (!needle) return [];

  const matches: PageMatch[] = [];

  for (const [blockIndex, entry] of prepared.entries()) {
    let cursor = 0;

    while (matches.length < limit) {
      const at = entry.folded.text.indexOf(needle, cursor);
      if (at < 0) break;

      const fromPlain = entry.folded.map[at] ?? entry.block.plain.length;
      const toPlain = entry.folded.map[at + needle.length] ?? entry.block.plain.length;
      const fromByte = entry.plainBytes[fromPlain] ?? entry.block.map.length;
      const toByte = entry.plainBytes[toPlain] ?? entry.block.map.length;
      const from = entry.rawMap[fromByte] ?? sourceText.length;
      const to = rawEndForByte(entry.rawMap, sourceText, toByte);

      if (to > from) matches.push({ blockIndex, from, to });

      cursor = at + Math.max(1, needle.length);
    }

    if (matches.length >= limit) break;
  }

  return matches;
}

function utf16ToByteOffsets(text: string): Uint32Array {
  const out = new Uint32Array(text.length + 1);
  let bytes = 0;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;

    const units = codePoint > 0xffff ? 2 : 1;
    out[index] = bytes;
    if (units === 2) out[index + 1] = bytes;
    bytes += utf8LengthOfCodePoint(codePoint);
    index += units;
  }

  out[text.length] = bytes;

  return out;
}
