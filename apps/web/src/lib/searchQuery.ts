/** Positive and negative terms parsed from one search box value. */
interface SearchTerm {
  text: string;
  phrase: boolean;
}

/** FTS5 expressions for one query. */
export interface BuiltSearchQuery {
  /** All positive terms, with the negative terms excluded. */
  strict: string;
  /** Any positive term, with the negative terms excluded. Null for one term. */
  loose: string | null;
  positive: string[];
  negative: string[];
}

/** FTS5 stops being useful with more terms than this, and the SQL gets long. */
const MAX_TERMS = 8;

/**
 * Builds the FTS5 MATCH expression for a palette query.
 *
 * Unquoted terms match as prefixes, so `typ` finds `typst`. A quoted phrase
 * stays exact. A leading `-` excludes a term or phrase.
 */
export function buildSearchQuery(input: string): BuiltSearchQuery | null {
  const terms = parseTerms(input);
  const positive: SearchTerm[] = [];
  const negative: SearchTerm[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const text = term.text.replace(/"/g, " ").replace(/\s+/g, " ").trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;

    const key = `${term.phrase ? "p" : "w"}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const target = term.exclude ? negative : positive;
    if (target.length < MAX_TERMS) target.push({ text, phrase: term.phrase });
  }

  if (positive.length === 0) return null;

  const positiveExpressions = positive.map(termExpression);
  const negativeExpressions = negative.map(termExpression);
  const negativeClause =
    negativeExpressions.length > 0 ? ` NOT (${negativeExpressions.join(" OR ")})` : "";
  const strict = `(${positiveExpressions.join(" ")})${negativeClause}`;
  const loose =
    positiveExpressions.length > 1
      ? `(${positiveExpressions.join(" OR ")})${negativeClause}`
      : null;

  return {
    strict,
    loose,
    positive: positive.map((term) => term.text),
    negative: negative.map((term) => term.text),
  };
}

function termExpression(term: SearchTerm): string {
  const quoted = `"${term.text}"`;
  // A one-character prefix matches too much. Quotes always mean exact.
  return term.phrase || term.text.length < 2 ? quoted : `${quoted}*`;
}

interface ParsedTerm extends SearchTerm {
  exclude: boolean;
}

function parseTerms(input: string): ParsedTerm[] {
  const terms: ParsedTerm[] = [];
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index] ?? "")) index++;
    if (index >= input.length) break;

    let exclude = false;
    if (input[index] === "-" && index + 1 < input.length && !/\s/.test(input[index + 1] ?? "")) {
      exclude = true;
      index++;
    }

    if (input[index] === '"') {
      index++;
      let text = "";
      while (index < input.length) {
        const char = input[index] ?? "";
        if (char === "\\" && index + 1 < input.length) {
          text += input[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (char === '"') {
          index++;
          break;
        }
        text += char;
        index++;
      }
      terms.push({ text, phrase: true, exclude });
      continue;
    }

    let text = "";
    while (index < input.length && !/\s/.test(input[index] ?? "")) {
      text += input[index] ?? "";
      index++;
    }
    terms.push({ text, phrase: false, exclude });
  }

  return terms;
}
