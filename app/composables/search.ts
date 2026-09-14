import type { WorkspaceStore } from "@typbase/storage";

import { SearchManager } from "~/lib/search";

function useSearchState() {
  const manager = shallowRef<SearchManager>();
  let promise: Promise<SearchManager> | undefined;

  onScopeDispose(() => {
    manager.value?.stop();
    manager.value = undefined;
    promise = undefined;
  });

  function ensure(store: WorkspaceStore): Promise<SearchManager> {
    if (manager.value && manager.value.workspaceId !== store.workspaceId) {
      manager.value.stop();
      manager.value = undefined;
      promise = undefined;
    }

    if (manager.value) return Promise.resolve(manager.value);

    promise ??= (async () => {
      const instance = new SearchManager(store);
      await instance.start();
      manager.value = instance;
      return instance;
    })();

    return promise;
  }

  return { search: computed(() => manager.value), ensure };
}

export const useSearch = createSharedComposable(useSearchState);
