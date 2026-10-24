import {
  createWispDomains,
  nextTid,
  publishStandardSite,
  publishWispSite,
  wispSiteUrl,
  type PublicRepo,
  type WispRequest,
} from "@typbase/spaces";
import { describe, expect, it } from "vitest";

import { isSiteEmbedAllowed } from "../src/lib/site/embeds";
import { siteSlug } from "../src/lib/site/slug";

class FakeRepo implements PublicRepo {
  readonly did = "did:plc:test";
  records = new Map<string, Record<string, unknown>>();
  order: string[] = [];
  uploads = 0;
  async getRecord(collection: string, rkey: string) {
    const value = this.records.get(`${collection}/${rkey}`);
    return value ? { uri: `at://${this.did}/${collection}/${rkey}`, cid: "cid", value } : null;
  }
  async putRecord(collection: string, rkey: string, value: Record<string, unknown>) {
    this.records.set(`${collection}/${rkey}`, value);
    this.order.push(collection);
    return { uri: `at://${this.did}/${collection}/${rkey}`, cid: "cid" };
  }
  async deleteRecord(collection: string, rkey: string) {
    this.records.delete(`${collection}/${rkey}`);
  }
  async uploadBlob() {
    this.uploads += 1;
    return {
      $type: "blob",
      ref: { $link: `bafy-${this.uploads}` },
      mimeType: "application/octet-stream",
      size: 1,
    };
  }
  async serviceAuth() {
    return "token";
  }
}

function file(name: string, text = name) {
  return { name, bytes: new TextEncoder().encode(text), mimeType: "text/html" };
}

interface WispTestNode {
  $type?: string;
  type?: string;
  entries?: Array<{ node: WispTestNode }>;
}

/** Every node `$type` in a manifest tree, including nested directories. */
function nodeTypes(entries: Array<{ node: WispTestNode }>): string[] {
  return entries.flatMap((entry) => [
    entry.node.$type ?? "",
    ...(entry.node.entries ? nodeTypes(entry.node.entries) : []),
  ]);
}

describe("Wisp publisher", () => {
  it("writes settings before the manifest", async () => {
    const repo = new FakeRepo();
    await publishWispSite(repo, {
      siteRkey: "notes",
      files: [file("index.html"), file("about/index.html")],
      settings: { cleanUrls: true, custom404: "404.html" },
    });

    expect(repo.order).toEqual(["place.wisp.settings", "place.wisp.fs"]);
    const manifest = repo.records.get("place.wisp.fs/notes") as
      | { site: string; fileCount: number; root: { entries: Array<{ node: WispTestNode }> } }
      | undefined;
    expect(manifest?.site).toBe("notes");
    expect(manifest?.fileCount).toBe(2);
    // Wisp validates the node union by `$type`; without it the record is
    // rejected and the host fences the site after repeated fetch failures.
    expect(nodeTypes(manifest?.root.entries ?? [])).toEqual([
      "place.wisp.fs#directory",
      "place.wisp.fs#file",
      "place.wisp.fs#file",
    ]);
  });

  it("splits a large site into subfs records", async () => {
    const repo = new FakeRepo();
    const files = Array.from({ length: 300 }, (_, index) => file(`p/${index}/index.html`));
    await publishWispSite(repo, { siteRkey: "large", files });

    const subfs = [...repo.records.keys()].filter((key) => key.startsWith("place.wisp.subfs/"));
    expect(subfs.length).toBeGreaterThan(0);
    const manifest = repo.records.get("place.wisp.fs/large") as
      | { fileCount: number; root: { entries: Array<{ node: WispTestNode }> } }
      | undefined;
    expect(JSON.stringify(manifest).length).toBeLessThan(140 * 1024);
    expect(manifest?.fileCount).toBe(300);
    expect(nodeTypes(manifest?.root.entries ?? [])).toContain("place.wisp.fs#subfs");

    const subfsRecord = repo.records.get(subfs[0]) as
      | { root: { $type?: string; entries: Array<{ node: WispTestNode }> } }
      | undefined;
    expect(subfsRecord?.root.$type).toBe("place.wisp.subfs#directory");
    expect(
      nodeTypes(subfsRecord?.root.entries ?? []).every((type) =>
        type.startsWith("place.wisp.subfs#"),
      ),
    ).toBe(true);
  });

  it("reuses unchanged blobs when the hash matches", async () => {
    const repo = new FakeRepo();
    const first = await publishWispSite(repo, {
      siteRkey: "reuse",
      files: [file("index.html", "one")],
    });
    const before = repo.uploads;
    const second = await publishWispSite(repo, {
      siteRkey: "reuse",
      files: [file("index.html", "one")],
      fileHashes: first.hashes,
    });

    expect(second.reused).toBe(1);
    expect(second.uploaded).toBe(0);
    expect(repo.uploads).toBe(before);
  });
});

describe("Wisp domains", () => {
  it("sends claims through the injected transport with service auth", async () => {
    const repo = new FakeRepo();
    const calls: WispRequest[] = [];
    const domains = createWispDomains(
      repo,
      "https://wisp.place",
      "did:web:wisp.place",
      async (request) => {
        calls.push(request);

        return {
          status: 200,
          body: JSON.stringify({
            domain: "notes.wisp.place",
            kind: "wisp",
            status: "verified",
          }),
        };
      },
    );

    const claim = await domains.claimSubdomain("notes", "notes");
    expect(claim.status).toBe("verified");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://wisp.place/xrpc/place.wisp.v2.domain.claimSubdomain",
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      handle: "notes",
      siteRkey: "notes",
    });
  });

  it("surfaces the Wisp error body when a claim is rejected", async () => {
    const repo = new FakeRepo();
    const domains = createWispDomains(
      repo,
      "https://wisp.place",
      "did:web:wisp.place",
      async () => ({
        status: 409,
        body: JSON.stringify({ message: "that label is already taken" }),
      }),
    );

    await expect(domains.claimSubdomain("notes", "notes")).rejects.toThrow(
      "that label is already taken",
    );
  });
});

describe("Standard.site publisher", () => {
  it("writes TID-keyed publication and document records", async () => {
    const repo = new FakeRepo();
    const result = await publishStandardSite(repo, {
      publication: {
        url: "https://notes.example.com",
        name: "Notes",
        description: "",
        showInDiscover: true,
        palette: {
          surface: "#ffffff",
          text: "#111111",
          accent: "#3366cc",
        },
      },
      documents: [
        {
          pageId: "page1",
          path: "/",
          title: "Home",
          description: "",
          tags: [],
          textContent: "Hello",
          publishedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      publicationRkey: null,
      publicationUri: null,
      documentRkeys: {},
    });

    expect(result.publicationRkey).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    expect(result.documentRkeys.page1).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    expect(repo.records.get(`site.standard.document/${result.documentRkeys.page1}`)?.site).toBe(
      result.publicationUri,
    );
  });
});

describe("TID", () => {
  it("is 13 base32-sortable characters and increases", () => {
    const first = nextTid(1_700_000_000_000);
    const second = nextTid(1_700_000_000_000);
    expect(first).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    expect(second > first).toBe(true);
  });
});

describe("site embeds", () => {
  it("allows a page to embed itself", () => {
    const allowed = new Set(["welcome"]);

    expect(isSiteEmbedAllowed("welcome", "welcome", allowed)).toBe(true);
    expect(isSiteEmbedAllowed("welcome", "private-page", allowed)).toBe(false);
  });
});

describe("site URLs", () => {
  it("keeps unicode page slugs and strips reserved characters", () => {
    expect(siteSlug("Hello, world!")).toBe("hello-world");
    expect(siteSlug("Привет мир")).toBe("привет-мир");
  });

  it("uses the shared path for the public Wisp host", () => {
    expect(wispSiteUrl("did:plc:abc", "notes")).toBe("https://sites.wisp.place/did:plc:abc/notes");
    expect(wispSiteUrl("did:plc:abc", "notes", "https://wisp.example.com")).toBe(
      "https://sites.wisp.example.com/did:plc:abc/notes",
    );
  });
});
