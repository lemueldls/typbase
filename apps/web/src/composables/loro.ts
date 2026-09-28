import type { LoroPath, WorkspaceStore } from "@typbase/storage";

/**
 * Top-level containers of the workspace doc a selector can depend on. The
 * union is what makes `useWorkspaceValue` dependencies typo-checked. Add a
 * name here when the store grows a new top-level container.
 */
export type WorkspaceContainer =
  | "pages"
  | "categories"
  | "settings"
  | "plugins"
  | "instances"
  | "chats";

/**
 * A computed over the workspace doc that only re-runs when one of
 * `containers` changes, instead of every workspace commit. `store` takes a
 * ref, a getter, or a plain store, so a workspace switch re-subscribes and
 * re-reads.
 *
 * The `fallback` overload is for callers whose store can be absent (the
 * shared `workspace` ref before boot or during a teardown). It keeps the
 * computed non-null.
 */
export function useWorkspaceValue<T>(
  store: MaybeRefOrGetter<WorkspaceStore>,
  containers: readonly WorkspaceContainer[],
  select: (store: WorkspaceStore) => T,
): ComputedRef<T>;
export function useWorkspaceValue<T>(
  store: MaybeRefOrGetter<WorkspaceStore | undefined>,
  containers: readonly WorkspaceContainer[],
  select: (store: WorkspaceStore) => T,
  fallback: T,
): ComputedRef<T>;
export function useWorkspaceValue<T>(
  store: MaybeRefOrGetter<WorkspaceStore | undefined>,
  containers: readonly WorkspaceContainer[],
  select: (store: WorkspaceStore) => T,
): ComputedRef<T | undefined>;
export function useWorkspaceValue<T>(
  store: MaybeRefOrGetter<WorkspaceStore | undefined>,
  containers: readonly WorkspaceContainer[],
  select: (store: WorkspaceStore) => T,
  fallback?: T,
): ComputedRef<T | undefined> {
  const paths: LoroPath[] = containers.map((container) => [container]);
  const revision = shallowRef(0);
  let stop: (() => void) | undefined;

  watch(
    () => toValue(store),
    (value) => {
      stop?.();
      stop = value?.onWorkspaceChange(paths, () => {
        revision.value += 1;
      });
    },
    { immediate: true },
  );
  onScopeDispose(() => stop?.());

  return computed(() => {
    void revision.value;
    const value = toValue(store);

    return value ? select(value) : fallback;
  });
}
