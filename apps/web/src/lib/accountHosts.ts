/**
 * Account providers offered when someone creates an account.
 *
 * Only providers with a confirmed open signup are listed. The list was checked
 * on 2026-11-13 against https://atmosphereaccount.com/hosts. Graze and Leaflet
 * are apps on the Atmosphere, not account providers. Blacksky and Surf are
 * left out until their signup is confirmed open.
 */
export interface AccountHost {
  id: string;
  name: string;
  host: string;
  signupUrl: string;
  note: string;
}

export const DEFAULT_ACCOUNT_HOST_ID = "bluesky";

export const ACCOUNT_HOSTS: readonly AccountHost[] = [
  {
    id: "bluesky",
    name: "Bluesky",
    host: "bsky.app",
    signupUrl: "https://bsky.app/",
    note: "The default provider, with open signup.",
  },
  {
    id: "tangled",
    name: "Tangled",
    host: "tangled.org",
    signupUrl: "https://tangled.org/signup",
    note: "A code forge that hosts accounts, with open signup.",
  },
  {
    id: "pckt",
    name: "pckt",
    host: "pckt.blog",
    signupUrl: "https://pckt.blog/register",
    note: "A blogging provider with open signup.",
  },
];

/** Directory for people whose provider is not in the curated list. */
export const ACCOUNT_HOSTS_URL = "https://atmosphereaccount.com/hosts";

/** Apps that use the same account. Social proof, not signup destinations. */
export const ATMOSPHERE_APPS = [
  "Bluesky",
  "Blacksky",
  "Graze",
  "Leaflet",
  "Tangled",
  "Surf",
  "pckt.blog",
] as const;

export function defaultAccountHost(): AccountHost {
  return ACCOUNT_HOSTS.find((host) => host.id === DEFAULT_ACCOUNT_HOST_ID) ?? ACCOUNT_HOSTS[0]!;
}
