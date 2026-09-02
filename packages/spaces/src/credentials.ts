import type { OAuthSession } from "@atproto/oauth-client-browser";

import { JoseKey } from "@atproto/jwk-jose";
import { Client, XrpcResponseError } from "@atproto/lex-client";
import { asStringFormat } from "@atproto/lex-schema";
import { createDpopProof } from "@atproto/space";

import { com } from "./lexicons";

/**
 * Short-lived, DPoP-bound credential for one space. Written like Bulletin's
 * SpaceCredential: `fetch` attaches the credential plus a fresh proof signed
 * by the ephemeral key minted alongside the token. Credentials expire after
 * ~2h; refresh means re-running the delegation + exchange, never reuse.
 */

export class SpaceCredential {
  constructor(
    readonly token: string,
    readonly key: JoseKey,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, { ...init, redirect: "error" });
    request.headers.set("authorization", `DPoP ${this.token}`);
    request.headers.set(
      "dpop",
      await createDpopProof(this.key, {
        htm: request.method,
        htu: request.url,
        credential: this.token,
      }),
    );

    return this.fetchImpl(request);
  };

  client(service: string): Client {
    return new Client({ service, fetch: this.fetch });
  }
}

export async function mintSpaceCredential(
  session: OAuthSession,
  space: string,
  authorityPds: string,
): Promise<SpaceCredential> {
  const viewerClient = new Client(session);
  const delegation = await viewerClient.call(com.atproto.space.getDelegationToken, {
    space: asStringFormat(space, "space-ref"),
  });

  const key = await JoseKey.generate(["ES256"]);
  const credential = await exchangeSpaceCredential({
    authorityPds,
    delegationToken: delegation.token,
    space,
    key,
  });

  return new SpaceCredential(credential, key);
}

export async function exchangeSpaceCredential(input: {
  authorityPds: string;
  delegationToken: string;
  space: string;
  key: JoseKey;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const url = new URL("/xrpc/com.atproto.space.getSpaceCredential", input.authorityPds);
  const request = new Request(url, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.delegationToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ space: input.space }),
  });
  request.headers.set(
    "dpop",
    await createDpopProof(input.key, {
      htm: request.method,
      htu: request.url,
    }),
  );

  const response = await (input.fetchImpl ?? fetch)(request);
  const body = (await response.json().catch(() => undefined)) as
    | { credential?: string; error?: string; message?: string }
    | undefined;

  if (!response.ok) {
    throw new XrpcResponseError(com.atproto.space.getSpaceCredential.main, response, {
      encoding: "application/json",
      body: {
        error: body?.error ?? "InvalidRequest",
        ...(body?.message ? { message: body.message } : {}),
      },
    });
  }
  if (!body?.credential) {
    throw new Error("Credential exchange returned no credential");
  }

  return body.credential;
}
