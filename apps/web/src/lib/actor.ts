/** Public identity and profile fields, from the AppView or the account's PDS. */
export interface PublicProfile {
  did: string;
  handle: string | null;
  displayName: string | null;
  description: string | null;
  avatar: string | null;
  banner: string | null;
}

interface AppViewProfile {
  did?: string;
  handle?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
}

const PUBLIC_APPVIEW = "https://public.api.bsky.app";

/** A typeahead result. The AppView only indexes accounts it knows about. */
export interface ActorSuggestion {
  did: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
}

interface AppViewSuggestion {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Suggest accounts by handle prefix. This is the public AppView's typeahead, so
 * an account on a PDS the AppView has not indexed returns no suggestion.
 * The full handle still resolves on submit.
 */
export async function searchPublicActors(query: string): Promise<ActorSuggestion[]> {
  const value = query.trim();
  if (value.length < 2) return [];

  try {
    const response = await fetch(
      `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(value)}&limit=5`,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { actors?: AppViewSuggestion[] };
    const actors = Array.isArray(body.actors) ? body.actors : [];

    return actors
      .filter((actor): actor is AppViewSuggestion & { did: string; handle: string } =>
        Boolean(actor.did && actor.handle),
      )
      .map((actor) => ({
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName?.trim() || null,
        avatar: actor.avatar ?? null,
      }));
  } catch {
    return [];
  }
}

/** Resolve a handle or DID to a DID. Returns null when the handle does not resolve. */
export async function resolveActorDid(identity: string): Promise<string | null> {
  const value = identity.trim();
  if (!value) return null;
  if (value.startsWith("did:")) return value;

  const profile = await fetchPublicProfile(value);

  return profile?.did ?? null;
}

/**
 * Read an account's public profile. The AppView is optional: an account on a
 * PDS that is not indexed there still has a handle, and callers fall back to
 * `com.atproto.repo.describeRepo` for that.
 */
export async function fetchPublicProfile(identity: string): Promise<PublicProfile | null> {
  try {
    const response = await fetch(
      `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(identity)}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as AppViewProfile;
    if (!body.did && !body.handle) return null;

    return {
      did: body.did ?? identity,
      handle: body.handle ?? null,
      displayName: body.displayName?.trim() || null,
      description: body.description?.trim() || null,
      avatar: body.avatar ?? null,
      banner: body.banner ?? null,
    };
  } catch {
    return null;
  }
}
