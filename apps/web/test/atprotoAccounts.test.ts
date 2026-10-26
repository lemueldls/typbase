import { describe, expect, it } from "vitest";

import type { AccountStorage, AtprotoAccount } from "../src/lib/atprotoAccounts";

import { readAccounts, writeAccounts } from "../src/lib/atprotoAccounts";

class MemoryStorage implements AccountStorage {
  constructor(public value: string | null = null) {}

  getItem(): string | null {
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

const BASE: AtprotoAccount = {
  did: "did:plc:alice",
  handle: "alice.test",
  displayName: "Alice",
  avatar: "https://cdn.example/alice.jpg",
  addedAt: 10,
  lastUsedAt: 20,
};

describe("saved atproto accounts", () => {
  it("reads an empty list without storage or data", () => {
    expect(readAccounts(null)).toEqual([]);
    expect(readAccounts(new MemoryStorage())).toEqual([]);
  });

  it("drops malformed entries and fills the profile defaults", () => {
    const before = Date.now();
    const after = Date.now();
    const storage = new MemoryStorage(
      JSON.stringify([
        { did: "did:plc:bob", handle: 4, lastUsedAt: 300 },
        { did: "did:plc:alice", handle: "alice.test", lastUsedAt: 100 },
        { handle: "missing-did" },
        null,
      ]),
    );

    const accounts = readAccounts(storage);

    expect(accounts.map((account) => account.did)).toEqual(["did:plc:bob", "did:plc:alice"]);
    expect(accounts[0]).toMatchObject({
      did: "did:plc:bob",
      handle: null,
      displayName: null,
      avatar: null,
      lastUsedAt: 300,
    });
    expect(accounts[0]?.addedAt).toBeGreaterThanOrEqual(before);
    expect(accounts[0]?.addedAt).toBeLessThanOrEqual(after);
  });

  it("sorts the most recently used account first", () => {
    const storage = new MemoryStorage(
      JSON.stringify([
        { ...BASE, did: "did:plc:alice", lastUsedAt: 10 },
        { ...BASE, did: "did:plc:bob", lastUsedAt: 30 },
        { ...BASE, did: "did:plc:carol", lastUsedAt: 20 },
      ]),
    );

    expect(readAccounts(storage).map((account) => account.did)).toEqual([
      "did:plc:bob",
      "did:plc:carol",
      "did:plc:alice",
    ]);
  });

  it("round-trips the saved summaries", () => {
    const storage = new MemoryStorage();
    writeAccounts([BASE], storage);

    expect(readAccounts(storage)).toEqual([BASE]);
  });

  it("ignores unreadable and blocked storage", () => {
    const unreadable: AccountStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {},
    };
    const unwritable: AccountStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    expect(readAccounts(unreadable)).toEqual([]);
    expect(() => writeAccounts([BASE], unwritable)).not.toThrow();
    expect(readAccounts(new MemoryStorage("{not json"))).toEqual([]);
    expect(readAccounts(new MemoryStorage("{}"))).toEqual([]);
  });
});
