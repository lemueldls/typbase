import type { WorkspaceStore } from "@typbase/storage";

import type { SearchStatus } from "~/lib/search";

import { SearchManager } from "~/lib/search";

function useSearchState() {
  const manager = shallowRef<SearchManager>();
  // The manager mutates one status object in place, so keep a shallow copy
  // fed by its change events; templates need a new reference to re-render.
  const status = shallowRef<SearchStatus | null>(null);
  let promise: Promise<SearchManager> | undefined;
  let offChange: (() => void) | undefined;

  onScopeDispose(() => {
    offChange?.();
    offChange = undefined;
    manager.value?.stop();
    manager.value = undefined;
    status.value = null;
    promise = undefined;
  });

  function ensure(store: WorkspaceStore): Promise<SearchManager> {
    if (manager.value && manager.value.workspaceId !== store.workspaceId) {
      offChange?.();
      offChange = undefined;
      manager.value.stop();
      manager.value = undefined;
      status.value = null;
      promise = undefined;
    }

    if (manager.value) return Promise.resolve(manager.value);

    promise ??= (async () => {
      const instance = new SearchManager(store);
      await instance.start();
      offChange = instance.onChange(() => {
        status.value = { ...instance.status };
      });
      status.value = { ...instance.status };
      manager.value = instance;
      return instance;
    })();

    return promise;
  }

  return { search: computed(() => manager.value), status, ensure };
}

export const useSearch = createSharedComposable(useSearchState);
