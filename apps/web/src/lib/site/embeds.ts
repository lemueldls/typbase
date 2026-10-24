/**
 * A page may embed itself. The renderer replaces a self-include with a comment
 * so the document does not recurse, and the site build uses the same rule.
 */
export function isSiteEmbedAllowed(
  pageId: string,
  targetId: string,
  allowed: ReadonlySet<string>,
): boolean {
  return targetId === pageId || allowed.has(targetId);
}
