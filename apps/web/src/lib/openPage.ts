import type { PageMeta, WorkspaceSettings } from "@typbase/typing";

/**
 * Which page the shell opens when nothing else picked one: the home page while
 * it still exists, else the first page, else null.
 *
 * The home page id can outlive its page. Deleting the home page clears the
 * setting, but a peer that deletes a page over sync never clears it here, so the
 * id is checked against the live list rather than trusted. Trusting it left the
 * pane on a deleted page, showing "no page" where the empty state belongs.
 */
export function resolveOpenPageId(
  settings: Pick<WorkspaceSettings, "homePageId">,
  pages: readonly PageMeta[],
): string | null {
  const home = settings.homePageId;
  if (home && pages.some((page) => page.id === home)) return home;

  return pages[0]?.id ?? null;
}
