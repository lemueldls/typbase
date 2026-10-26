import type { SiteSettings } from "@typbase/typing";

import { DEFAULT_SITE_SETTINGS } from "@typbase/typing";
import { describe, expect, it } from "vitest";

import { forkSiteSettings } from "../src/lib/site/fork";

const CONFIGURED: SiteSettings = {
  ...DEFAULT_SITE_SETTINGS,
  name: "Field notes",
  slug: "field-notes",
  theme: "light",
  wisp: {
    ...DEFAULT_SITE_SETTINGS.wisp,
    serviceUrl: "https://wisp.example",
    serviceDid: "did:web:wisp.example",
    siteRkey: "old-key",
    subdomain: "old",
    customDomain: "notes.example",
    domainStatus: "verified",
    domainError: "stale",
    domainDns: { txtName: "txt", txtValue: "value", cnameTarget: "target" },
    publisherDid: "did:plc:old",
    lastDeploy: {
      url: "https://notes.example",
      wispUri: "at://did:plc:old/place.wisp.fs/old-key",
      manifestCid: "bafy",
      deployedAt: 1,
      buildHash: "hash",
      pageCount: 2,
      fileCount: 3,
      totalBytes: 4,
      standardPublicationUri: "at://did:plc:old/site.standard.publication/pub",
    },
  },
  standard: {
    ...DEFAULT_SITE_SETTINGS.standard,
    enabled: false,
    publicationRkey: "pub",
    publicationUri: "at://did:plc:old/site.standard.publication/pub",
    documentRkeys: { page: "doc" },
    showInDiscover: false,
  },
};

describe("forking a site to another account", () => {
  it("keeps the site and endpoint but drops the previous publisher's state", () => {
    const next = forkSiteSettings(CONFIGURED, "new-key");

    expect(next.name).toBe("Field notes");
    expect(next.slug).toBe("field-notes");
    expect(next.theme).toBe("light");
    expect(next.wisp).toMatchObject({
      serviceUrl: "https://wisp.example",
      serviceDid: "did:web:wisp.example",
      siteRkey: "new-key",
      subdomain: "",
      customDomain: "",
      domainStatus: "none",
      domainError: "",
      domainDns: null,
      publisherDid: null,
      lastDeploy: null,
    });
    expect(next.standard).toEqual({
      enabled: false,
      publicationRkey: null,
      publicationUri: null,
      documentRkeys: {},
      showInDiscover: false,
    });
  });

  it("does not mutate the saved settings", () => {
    forkSiteSettings(CONFIGURED, "new-key");

    expect(CONFIGURED.wisp.publisherDid).toBe("did:plc:old");
    expect(CONFIGURED.wisp.customDomain).toBe("notes.example");
    expect(CONFIGURED.standard.publicationRkey).toBe("pub");
  });
});
