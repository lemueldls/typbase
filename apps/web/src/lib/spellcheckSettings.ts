import type { IgnoredSpellcheckLint } from "@typbase/typing";

/**
 * Pure conversions between the workspace settings and the shapes harper.js
 * takes. Kept out of `spellcheck.ts` so the unit suite can import them
 * without CodeMirror or the Harper worker.
 */

/** Trims, drops empties, and removes case-insensitive duplicates. */
export function normalizeDictionaryWords(raw: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const words: string[] = [];

  for (const value of raw ?? []) {
    if (typeof value !== "string") continue;

    const word = value.trim();
    if (!word) continue;

    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    words.push(word);
  }

  return words;
}

/** Appends one word unless a case variant is already there. */
export function addDictionaryWord(words: readonly string[], word: string): string[] {
  return normalizeDictionaryWords([...words, word]);
}

/**
 * harper.js's ignored-lints format is `{"context_hashes":[<u64>, ...]}`.
 * Hashes live in settings as decimal strings because they overflow JS
 * numbers, so they are interpolated raw; anything not all digits is dropped.
 */
export function ignoredLintsJson(entries: readonly IgnoredSpellcheckLint[]): string {
  const seen = new Set<string>();
  const hashes: string[] = [];

  for (const entry of entries) {
    if (!/^\d+$/.test(entry.hash) || seen.has(entry.hash)) continue;

    seen.add(entry.hash);
    hashes.push(entry.hash);
  }

  return `{"context_hashes":[${hashes.join(",")}]}`;
}

/** Appends an ignored lint unless its hash is malformed or already present. */
export function addIgnoredLint(
  entries: IgnoredSpellcheckLint[],
  entry: IgnoredSpellcheckLint,
): IgnoredSpellcheckLint[] {
  if (!/^\d+$/.test(entry.hash) || entries.some((existing) => existing.hash === entry.hash)) {
    return entries;
  }

  return [...entries, entry];
}

/**
 * The word a spelling span points at, without surrounding punctuation. A span
 * covering a phrase is not a dictionary entry, so it returns null.
 */
export function dictionaryWord(raw: string): string | null {
  const word = raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!word || !/^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u.test(word)) return null;

  return word;
}
