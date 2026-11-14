import { OAUTH_SCOPES } from "@typbase/typing";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACCOUNT_HOSTS, ATMOSPHERE_APPS, DEFAULT_ACCOUNT_HOST_ID } from "../src/lib/accountHosts";
import {
  ACCOUNT_SCOPE_GROUPS,
  staleAccountScopes,
  uncoveredAccountScopes,
} from "../src/lib/accountScopes";
import { DATA_LABEL_GROUPS, NOT_COLLECTED_KEYS, collectionsInLabel } from "../src/lib/dataLabel";

const en = JSON.parse(
  readFileSync(new URL("../i18n/locales/en.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function hasMessage(key: string): boolean {
  let value: unknown = en;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || !(part in value)) return false;
    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === "string" && value.length > 0;
}

describe("account scope groups", () => {
  it("covers every requested scope", () => {
    expect(uncoveredAccountScopes()).toEqual([]);
  });

  it("does not list a scope the client stopped requesting", () => {
    expect(staleAccountScopes()).toEqual([]);
  });

  it("gives every group a title, a body, and at least one scope", () => {
    for (const group of ACCOUNT_SCOPE_GROUPS) {
      expect(group.titleKey.length).toBeGreaterThan(0);
      expect(group.bodyKey.length).toBeGreaterThan(0);
      expect(group.scopes.length).toBeGreaterThan(0);
    }
  });
});

describe("data label", () => {
  it("lists every public repo collection", () => {
    const labelled = new Set(collectionsInLabel());
    const repo = OAUTH_SCOPES.filter((scope) => scope.startsWith("repo:")).map((scope) =>
      scope.slice("repo:".length),
    );

    expect(repo.filter((collection) => !labelled.has(collection))).toEqual([]);
  });

  it("lists the workspace collections", () => {
    const labelled = new Set(collectionsInLabel());

    for (const collection of [
      "at.typbase.update",
      "at.typbase.snapshot",
      "at.typbase.post",
      "at.typbase.asset",
    ]) {
      expect(labelled.has(collection)).toBe(true);
    }
  });

  it("tells the reader how to remove every entry", () => {
    for (const group of DATA_LABEL_GROUPS) {
      expect(hasMessage(group.titleKey)).toBe(true);
      expect(hasMessage(group.introKey)).toBe(true);
      for (const entry of group.entries) {
        expect(hasMessage(entry.titleKey)).toBe(true);
        expect(hasMessage(entry.bodyKey)).toBe(true);
        expect(hasMessage(entry.removalKey)).toBe(true);
      }
    }
  });

  it("keeps a not-collected section", () => {
    expect(NOT_COLLECTED_KEYS.length).toBeGreaterThan(0);
    for (const key of NOT_COLLECTED_KEYS) {
      expect(hasMessage(key)).toBe(true);
    }
  });
});

describe("account hosts", () => {
  it("has a default host", () => {
    expect(ACCOUNT_HOSTS.some((host) => host.id === DEFAULT_ACCOUNT_HOST_ID)).toBe(true);
  });

  it("lists only providers with a confirmed open signup", () => {
    expect(ACCOUNT_HOSTS.map((host) => host.id)).toEqual(["bluesky", "tangled", "pckt"]);
  });

  it("keeps apps that do not host accounts out of the provider list", () => {
    expect(ACCOUNT_HOSTS.map((host) => host.id)).not.toContain("graze");
    expect(ACCOUNT_HOSTS.map((host) => host.id)).not.toContain("leaflet");
    expect(ATMOSPHERE_APPS).toContain("Graze");
    expect(ATMOSPHERE_APPS).toContain("Leaflet");
  });
});
