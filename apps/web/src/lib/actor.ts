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
