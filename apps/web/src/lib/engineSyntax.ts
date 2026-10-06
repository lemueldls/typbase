import type { NotebookCell } from "@typbase/codemirror";
import type { FileId, FlattenedBlock, LinkSpan, SectionSpan, TypstState } from "@typbase/engine";

export function cellsOf(state: TypstState, fileId: FileId, text: string): NotebookCell[] {
  return state.extractCells(fileId, text) as NotebookCell[];
}

export function sectionsOf(state: TypstState, text: string): SectionSpan[] {
  return state.extractSections(undefined, text);
}

export function blocksOf(state: TypstState, text: string): FlattenedBlock[] {
  return state.flattenDocument(undefined, text);
}

export function linksOf(state: TypstState, text: string): LinkSpan[] {
  return state.extractLinks(undefined, text);
}
