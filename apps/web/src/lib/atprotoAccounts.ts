/** A signed-in account remembered on this device. */
export interface AtprotoAccount {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  addedAt: number;
  lastUsedAt: number;
}

/** The subset of localStorage the account list uses. */
export interface AccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ACCOUNT_STORAGE_KEY = "typbase:atprotoAccounts";

function defaultStorage(): AccountStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the saved account summaries. The OAuth client owns the sessions; this
 * list only carries the profile fields the account switcher needs before a
 * session is restored.
 */
export function readAccounts(storage: AccountStorage | null = defaultStorage()): AtprotoAccount[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).did === "string",
      )
      .map((entry) => ({
        did: String(entry.did),
        handle: typeof entry.handle === "string" ? entry.handle : null,
        displayName: typeof entry.displayName === "string" ? entry.displayName : null,
        avatar: typeof entry.avatar === "string" ? entry.avatar : null,
        addedAt: typeof entry.addedAt === "number" ? entry.addedAt : Date.now(),
        lastUsedAt: typeof entry.lastUsedAt === "number" ? entry.lastUsedAt : Date.now(),
      }))
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  } catch {
    return [];
  }
}

/** Persist the account summaries. A blocked storage must not break sign-in. */
export function writeAccounts(
  accounts: readonly AtprotoAccount[],
  storage: AccountStorage | null = defaultStorage(),
): void {
  if (!storage) return;

  try {
    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Private contexts can reject localStorage writes. The session still works.
  }
}
