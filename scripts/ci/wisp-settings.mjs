// Writes the `place.wisp.settings` record for a site deployed with wispctl.
//
// CI deploys files only. `wispctl deploy --spa`/`--directory` replaces the
// whole settings record, which would drop the COOP/COEP headers the app needs
// for cross-origin isolation, so this script owns that record instead. It
// runs after the deploy and talks to the PDS directly with an app password;
// the wisp firehose picks the change up like any other settings update.
//
// Usage: WISPCTL_APP_PASSWORD=... node scripts/ci/wisp-settings.mjs <handle> <site>
//
// `WISP_PDS_URL` skips handle and DID resolution against a known PDS.

const [, , handle, site] = process.argv;
if (!handle || !site) {
  console.error("usage: wisp-settings.mjs <handle> <site>");
  process.exit(1);
}

const password = process.env.WISPCTL_APP_PASSWORD;
if (!password) {
  console.error("WISPCTL_APP_PASSWORD is not set");
  process.exit(1);
}

const headers = [
  { name: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { name: "Cross-Origin-Embedder-Policy", value: "credentialless" },
  { name: "X-Frame-Options", value: "SAMEORIGIN" },
];

// `spaMode` serves index.html for client routes that were never prerendered,
// which is the only way `/u/<did>` resolves on a static host. `cleanUrls`
// matches what wispctl writes when it creates the record itself.
const record = {
  $type: "place.wisp.settings",
  cleanUrls: true,
  spaMode: "index.html",
  headers,
};

const timeout = () => AbortSignal.timeout(15_000);

async function getJson(url) {
  const response = await fetch(url, { signal: timeout() });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

/** handle -> DID through the public AppView. */
async function resolveDid(input) {
  if (input.startsWith("did:")) return input;

  const body = await getJson(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(input)}`,
  );

  return body.did;
}

/** DID document -> the account's PDS endpoint. */
async function resolvePds(did) {
  const url = did.startsWith("did:web:")
    ? `https://${did.slice("did:web:".length).replace(/:/g, "%3A")}/.well-known/did.json`
    : `https://plc.directory/${encodeURIComponent(did)}`;
  const doc = await getJson(url);
  const service = (doc.service ?? []).find(
    (entry) =>
      entry.type === "AtprotoPersonalDataServer" || String(entry.id).endsWith("#atproto_pds"),
  );
  if (!service?.serviceEndpoint) {
    throw new Error(`no atproto_pds service in the DID document for ${did}`);
  }

  return String(service.serviceEndpoint).replace(/\/$/, "");
}

async function callPds(pds, method, body, token) {
  const response = await fetch(`${pds}/xrpc/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: timeout(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json?.message ?? json?.error ?? response.status;
    throw new Error(`${method} failed: ${detail}`);
  }

  return json;
}

const did = await resolveDid(handle).catch((cause) => {
  throw new Error(`could not resolve ${handle}: ${cause.message}`);
});
const pds = process.env.WISP_PDS_URL?.replace(/\/$/, "") || (await resolvePds(did));
const session = await callPds(pds, "com.atproto.server.createSession", {
  identifier: handle,
  password,
});
if (!session?.accessJwt) {
  throw new Error("createSession returned no access token; check the app password");
}
const result = await callPds(
  pds,
  "com.atproto.repo.putRecord",
  {
    repo: did,
    collection: "place.wisp.settings",
    rkey: site,
    record,
  },
  session.accessJwt,
);

console.log(`wrote place.wisp.settings/${site} to ${pds} (${result.uri})`);
