import type { WorkspaceStore } from "@typbase/storage";

import { SearchManager } from "~/lib/search";

/**
 * One SearchManager per workspace, shared through createSharedComposable.
 * Created lazily after the store opens (cmd-K or the settings panel start
 * it); the manager is torn down with its scope, terminating its workers, so
 * leaving the workspace does not leak the sqlite/embed threads.
 */
function useSearchState() {
  const manager = shallowRef<SearchManager>();
  let promise: Promise<SearchManager> | undefined;

  onScopeDispose(() => {
    manager.value?.stop();
    manager.value = undefined;
    promise = undefined;
  });

  function ensure(store: WorkspaceStore): Promise<SearchManager> {
    // Workspace switched: the old manager indexes the previous workspace.
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
