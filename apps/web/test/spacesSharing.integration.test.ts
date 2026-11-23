import type { DidString } from "@atproto/lex-schema";
import type { SpaceRefString } from "@atproto/lex-space";
import type { OAuthSession } from "@typbase/spaces";

import { TestNetworkNoAppView } from "@atproto/dev-env";
import { Client } from "@atproto/lex-client";
import { l } from "@atproto/lex-schema";
import { lexicons } from "@atproto/lex-space";
import {
  createSharedTransport,
  openSharedWorkspaceSpace,
  parseWorkspaceSpaceRef,
  WORKSPACE_SPACE_TYPE,
} from "@typbase/spaces";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.SPACES_INTEGRATION === "1";

const createAccount = l.procedure(
  "com.atproto.server.createAccount",
  l.params(),
  l.jsonPayload({
    handle: l.string({ format: "handle" }),
    email: l.optional(l.string()),
    password: l.optional(l.string()),
  }),
  l.jsonPayload({
    did: l.string({ format: "did" }),
    handle: l.string({ format: "handle" }),
    accessJwt: l.string(),
    refreshJwt: l.string(),
  }),
);

interface TestUser {
  did: DidString;
  client: Client;
  session: OAuthSession;
}

async function createUser(pdsUrl: string, handle: `${string}.${string}`): Promise<TestUser> {
  const service = pdsUrl;
  const name = handle.split(".")[0];
  const unauthenticated = new Client({ service });
  const { did, accessJwt } = await unauthenticated.call(createAccount, {
    handle,
    email: `${name}@test.com`,
    password: `${name}-pass`,
  });
  const client = new Client({
    did,
    service,
    headers: { authorization: `Bearer ${accessJwt}` },
  });
  const session = {
    did,
    serverMetadata: { issuer: service },
    fetchHandler: (path: `/${string}`, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${accessJwt}`);
      return fetch(new URL(path, service), { ...init, headers });
    },
  } as unknown as OAuthSession;

  return { did, client, session };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);

  return items;
}

describe.skipIf(!enabled)("cross-account workspace space", () => {
  let network: TestNetworkNoAppView;
  let alice: TestUser;
  let bob: TestUser;
  let spaceUri: SpaceRefString;
  let aliceRecordRkey: string;

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({ extraPdses: 1 });
    alice = await createUser(network.pds.url, "alice.test");
    bob = await createUser(network.extraPdses[0].url, "bob.test2");

    const created = await alice.client.call(lexicons.com.atproto.space.createSpace, {
      spaceType: WORKSPACE_SPACE_TYPE,
      skey: "sharingtest",
      policy: lexicons.com.atproto.memberspace.policy.$build({}),
    });
    spaceUri = created.space;

    await alice.client.call(lexicons.com.atproto.memberspace.putMembers, {
      space: spaceUri,
      members: [{ did: bob.did, read: true, write: true }],
    });

    const record = await alice.client.call(lexicons.com.atproto.space.createRecord, {
      space: spaceUri,
      repo: alice.did,
      collection: "at.typbase.update",
      record: {
        $type: "at.typbase.update",
        docId: "doc",
        update: "alice",
        version: "1",
        createdAt: new Date().toISOString(),
      },
    });
    aliceRecordRkey = record.uri.split("/").pop()!;
  }, 120_000);

  afterAll(async () => {
    await network?.close();
  });

  it("mints a credential, lists writers, and reads another member's repo", async () => {
    const ref = parseWorkspaceSpaceRef(spaceUri);
    expect(ref).not.toBeNull();

    const bobSpace = await openSharedWorkspaceSpace({
      session: bob.session,
      ref: ref!,
      plcDirectoryUrl: network.plc.url,
    });

    const writers = await collect(bobSpace.reader.writers());
    expect(writers).toContainEqual(expect.objectContaining({ repo: alice.did }));

    const { body } = await bobSpace.reader.listRecords({
      repo: alice.did,
      collection: "at.typbase.update",
    });
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.value).toMatchObject({ docId: "doc", update: "alice" });

    const record = await bobSpace.reader.getRecord("at.typbase.update", aliceRecordRkey, {
      repo: alice.did,
    });
    expect(record.body.value).toMatchObject({ docId: "doc", update: "alice" });
  });

  it("writes to the member's own repo", async () => {
    const bobSpace = await openSharedWorkspaceSpace({
      session: bob.session,
      ref: parseWorkspaceSpaceRef(spaceUri)!,
      plcDirectoryUrl: network.plc.url,
    });

    await bobSpace.own.update.create({
      docId: "bob-doc",
      update: "bob",
      version: "1",
      createdAt: new Date().toISOString(),
    });

    const writers = await collect(bobSpace.reader.writers());
    expect(writers).toContainEqual(expect.objectContaining({ repo: bob.did }));
  });

  it("lists every writer and reads their raw update records", async () => {
    const bobSpace = await openSharedWorkspaceSpace({
      session: bob.session,
      ref: parseWorkspaceSpaceRef(spaceUri)!,
      plcDirectoryUrl: network.plc.url,
    });
    const transport = createSharedTransport(bobSpace);
    const repos = await transport.listRepos!();

    expect(repos).toEqual(expect.arrayContaining([alice.did, bob.did]));

    const updates = await transport.listUpdates(null, alice.did);
    expect(updates.records).toContainEqual(expect.objectContaining({ docId: "doc" }));
  });

  it("refuses a fresh credential after the member is removed", async () => {
    await alice.client.call(lexicons.com.atproto.memberspace.removeMembers, {
      space: spaceUri,
      dids: [bob.did],
    });

    const bobSpace = await openSharedWorkspaceSpace({
      session: bob.session,
      ref: parseWorkspaceSpaceRef(spaceUri)!,
      plcDirectoryUrl: network.plc.url,
    });

    await expect(bobSpace.reader.listWriters()).rejects.toThrow();
  });
});
