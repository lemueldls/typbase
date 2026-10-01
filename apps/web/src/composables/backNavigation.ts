/**
 * Mobile back handling. Transient overlays (the drawer, the search palette,
 * dialogs, menus, plugin windows) push a same-URL history entry while they are
 * open, so the Android back button, the browser back button, and the iOS
 * swipe close the top overlay before they leave the app or the page.
 *
 * Each layer owns one entry:
 * - opening pushes it,
 * - back closes the layer (the traversal already consumed the entry),
 * - closing from the UI goes back once to consume it,
 * - a navigation that happens while a layer is open replaces that entry, so
 *   back from the destination lands before the overlay instead of reopening it.
 *
 * A close defers its `history.back()` to a microtask: a dialog that closes and
 * then emits a navigation in the same tick gets the replace path, not a race
 * between the traversal and the router push.
 */

interface LayerEntry {
  close: () => void;
  consume: () => void;
}

const stack: LayerEntry[] = [];
let ignoredBacks = 0;
/** Reactive depth, so a control can show that back has somewhere to go. */
const layerDepth = ref(0);

function removeEntry(entry: LayerEntry): void {
  const index = stack.indexOf(entry);
  if (index !== -1) stack.splice(index, 1);
  layerDepth.value = stack.length;
}

export interface BackLayerHandle {
  /** Arms a fresh entry for a layer that is still open (see the window layer). */
  push(): void;
}

export function useBackLayer(open: Ref<boolean>, close?: () => void): BackLayerHandle {
  const dismiss = close ?? (() => (open.value = false));
  let pushed = false;
  let consumed = false;
  let closing = false;

  const entry: LayerEntry = {
    close: dismiss,
    consume: () => {
      consumed = true;
      closing = false;
      pushed = false;
      removeEntry(entry);
    },
  };

  function arm(): void {
    pushed = true;
    consumed = false;
    stack.push(entry);
    layerDepth.value = stack.length;
    history.pushState({ ...history.state, typbaseLayer: true }, "");
  }

  watch(
    open,
    (value, previous) => {
      if (value && !pushed) {
        arm();

        return;
      }

      if (value || !pushed || !previous) return;

      pushed = false;
      if (consumed) {
        consumed = false;
        removeEntry(entry);

        return;
      }

      closing = true;
      queueMicrotask(() => {
        if (!closing) return;

        closing = false;
        removeEntry(entry);
        // A newer layer owns the current entry. Leaving ours behind costs one
        // extra back but must not pop theirs.
        if (stack.length > 0) return;

        ignoredBacks += 1;
        history.back();
      });
    },
    { immediate: true, flush: "sync" },
  );

  onScopeDispose(() => {
    closing = false;
    consumed = false;
    pushed = false;
    removeEntry(entry);
    // No `history.back()` here: the dispose can be part of a route change,
    // and going back would undo it. The entry is left behind. The next back
    // lands on it and re-renders the same state.
  });

  return { push: arm };
}

/** True while an overlay owns a history entry. */
export function hasBackLayer(): boolean {
  return stack.length > 0;
}

/** How many overlays own an entry right now. Reactive, unlike `hasBackLayer`. */
export function backLayerDepth(): Ref<number> {
  return layerDepth;
}

/**
 * Marks the top layer's entry as consumed by a navigation. The caller closes
 * the overlay. Its watcher then skips the `history.back()`.
 */
export function consumeTopBackLayer(): boolean {
  const entry = stack.at(-1);
  if (!entry) return false;

  entry.consume();

  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignoredBacks > 0) {
      ignoredBacks -= 1;

      return;
    }

    const entry = stack.at(-1);
    if (!entry) return;

    entry.consume();
    entry.close();
  });
}
