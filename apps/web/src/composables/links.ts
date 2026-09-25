import type { WorkspaceStore } from "@typbase/storage";

import type { LinkIndex, LinkStatus } from "~/lib/links";

import { useEngineHealth } from "~/lib/engineHealth";
import { dropLinkIndexes, getLinkIndex } from "~/lib/linkIndex";
import { testApi } from "~/lib/testApi";

/**
 * The workspace's link index, started on first use. The backlinks panel, the
 * graph, and the Typst query channel all share this one instance, so a page
 * edit re-extracts once and every surface sees the same records.
 */
function useLinksState() {
  const index = shallowRef<LinkIndex>();
  const status = shallowRef<LinkStatus | null>(null);
  let offChange: (() => void) | undefined;
  const health = useEngineHealth();

  watch(health, (value) => {
    // A sweep that failed while the engine was down left empty records; once
    // a compile confirms the rebuild, run it again.
    if (value.status === "ok" && index.value?.status.error) index.value.retry();
  });

  function reset(): void {
    offChange?.();
    offChange = undefined;
    index.value?.stop();
    index.value = undefined;
    status.value = null;
  }

  function ensure(store: WorkspaceStore): LinkIndex {
    if (index.value && index.value.workspaceId !== store.workspaceId) reset();
    if (index.value) return index.value;

    // Keep only the active workspace's index; the others hold every page's
    // records for as long as the app lives.
    dropLinkIndexes(store.workspaceId);
    const instance = getLinkIndex(store);
    offChange = instance.onChange(() => {
      status.value = { ...instance.status };
    });
    status.value = { ...instance.status };
    index.value = instance;
    testApi.backlinksFor = (pageId) => instance.backlinksFor(pageId).map((group) => group.pageId);
    void instance.start();

    return instance;
  }

  onScopeDispose(reset);

  return { index: computed(() => index.value), status, ensure };
}

export const useLinks = createSharedComposable(useLinksState);
