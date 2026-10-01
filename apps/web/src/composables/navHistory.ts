import type { NavQuery } from "~/lib/navStack";

import { createNavStack } from "~/lib/navStack";

import { backLayerDepth } from "./backNavigation";

/**
 * Back and forward over the app's own navigation.
 *
 * The browser history stays the source of truth: every navigation still writes
 * the route, and the route watchers still apply a traversal or a pasted link.
 * This only remembers *where we are* in that history, because the browser will
 * not say whether an entry exists ahead of the cursor, which a forward control
 * has to know.
 *
 * Each entry the app writes carries its mirror index in `history.state`
 * (`typbaseIndex`), so a traversal places itself without tracking a direction.
 * An overlay entry from `backNavigation` spreads the state it was pushed from
 * and marks itself `typbaseLayer`: it inherits the index it borrowed and is
 * skipped here, which is what keeps the two sequences interleaved correctly.
 */

const stack = createNavStack();
const canBack = ref(false);
const canForward = ref(false);
const previousQuery = ref<NavQuery | undefined>(undefined);
const nextQuery = ref<NavQuery | undefined>(undefined);

function publish(): void {
  // An open overlay owns an entry of its own, so back has somewhere to go even
  // when the app itself has no history yet.
  canBack.value = stack.canBack || backLayerDepth().value > 0;
  canForward.value = stack.canForward;
  previousQuery.value = stack.previous?.query;
  nextQuery.value = stack.next?.query;
}

watch(backLayerDepth, publish);

export interface NavHistory {
  canBack: Ref<boolean>;
  canForward: Ref<boolean>;
  /** Route the back control would land on, for its label. */
  previousQuery: Ref<NavQuery | undefined>;
  /** Route the forward control would land on, for its label. */
  nextQuery: Ref<NavQuery | undefined>;
  /** Records a navigation and returns the index to tag its entry with. */
  record(query: NavQuery, options?: { append?: boolean }): number;
  /** Drops the past: a workspace switch starts a new context. */
  reset(query: NavQuery): void;
  goBack(): void;
  goForward(): void;
}

function goBack(): void {
  // Without this the desktop shell would have nothing to do with the key, and a
  // browser tab would leave the site.
  if (!canBack.value) return;

  window.history.back();
}

function goForward(): void {
  if (!canForward.value) return;

  window.history.forward();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => {
    const state = (event.state ?? {}) as { typbaseIndex?: number; typbaseLayer?: boolean };
    if (state.typbaseLayer) return;

    stack.land(state.typbaseIndex, locationQuery());
    publish();
  });

  /** The route the browser is showing, for a mirror that had to restart. */
  function locationQuery(): NavQuery {
    const query: NavQuery = {};
    for (const [key, value] of new URLSearchParams(window.location.search)) query[key] = value;

    return query;
  }
}

export function useNavHistory(): NavHistory {
  return {
    canBack,
    canForward,
    previousQuery,
    nextQuery,
    record(query, options) {
      const index = stack.record(query, options);
      publish();

      return index;
    },
    reset(query) {
      stack.reset(query);
      publish();
    },
    goBack,
    goForward,
  };
}
