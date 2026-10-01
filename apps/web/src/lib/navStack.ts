/**
 * The app's own navigation history, as a mirror of the browser's.
 *
 * The browser will not say whether an entry exists ahead of the cursor, so a
 * back *and forward* control needs the app to remember what it pushed. The
 * browser stays the source of truth: this only records where each entry is, and
 * every entry carries its mirror index in `history.state` so a traversal can be
 * placed without tracking a direction.
 *
 * Pure on purpose. `history` and the route live in `useNavHistory`, and an
 * overlay entry that borrowed an index is handled there.
 */

/**
 * The route query, kept loose: the mirror stores it only to name a destination
 * in a tooltip, and the caller narrows the values it reads.
 */
export type NavQuery = Record<string, unknown>;

export interface NavEntry {
  /** Position in the mirror, also the value written into `history.state`. */
  index: number;
  query: NavQuery;
}

export interface NavStack {
  /** Where the app stands, or undefined before the first navigation. */
  readonly current: NavEntry | undefined;
  readonly previous: NavEntry | undefined;
  readonly next: NavEntry | undefined;
  readonly canBack: boolean;
  readonly canForward: boolean;
  /** Stores `query` and returns the index to tag the history entry with. */
  record(query: NavQuery, options?: { append?: boolean }): number;
  /** A traversal landed on the entry tagged `index`, or on an unknown one. */
  land(index: number | undefined, query: NavQuery): void;
  /** Drops the past: a different workspace is a different context. */
  reset(query: NavQuery): void;
}

export function createNavStack(): NavStack {
  const entries: NavEntry[] = [];
  let at = -1;

  function store(index: number, query: NavQuery): number {
    const entry: NavEntry = { index, query };
    if (index === entries.length) entries.push(entry);
    else entries[index] = entry;

    at = index;

    return index;
  }

  return {
    get current() {
      return at < 0 ? undefined : entries[at];
    },
    get previous() {
      return at > 0 ? entries[at - 1] : undefined;
    },
    get next() {
      return at >= 0 && at < entries.length - 1 ? entries[at + 1] : undefined;
    },
    get canBack() {
      return at > 0;
    },
    get canForward() {
      return at >= 0 && at < entries.length - 1;
    },

    record(query, options = {}) {
      // A push drops whatever was ahead. A replace rewrites where the app
      // stands, and a mirror with no entry yet has to start somewhere.
      if (!options.append && at >= 0) return store(at, query);

      if (at >= 0) entries.length = at + 1;

      return store(entries.length, query);
    },

    land(index, query) {
      if (index !== undefined && index >= 0 && index < entries.length) {
        at = index;

        return;
      }

      // An entry the app never tagged (a pasted link's history, a reload): the
      // mirror restarts here, since nothing behind it is known to be ours.
      entries.length = 0;
      store(0, query);
    },

    reset(query) {
      entries.length = 0;
      store(0, query);
    },
  };
}
