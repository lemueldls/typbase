import type { OAuthSession } from "@typbase/spaces";

import { createPluginBundle } from "@typbase/plugin-sdk";
import { listPublisherPlugins, publishPlugin, resolvePlugin } from "@typbase/spaces";
import { passwordSession } from "airspace";
import { describe, expect, it } from "vitest";

import { parseManifest } from "../src/lib/plugins/manifest";

const service = process.env.PDS_SERVICE;
const handle = process.env.PDS_ALICE_HANDLE;
const password = process.env.PDS_ALICE_PASSWORD;
const configured = Boolean(service && handle && password);

describe.skipIf(!configured)("plugin registry against a test PDS", () => {
  it("publishes and resolves a signed listing and artifact", async () => {
    const session = await passwordSession({
      service: service!,
      identifier: handle!,
      password: password!,
    });
    const did = session.did;
    const slug = `plugin-test-${Date.now()}`;
    const listingUri = `at://${did}/at.typbase.plugin/${slug}`;
    const manifest = parseManifest({
      id: listingUri,
      name: "Registry test",
      version: "0.0.1",
      api: "typbase.host.v2",
      entry: "main.typ",
      capabilities: ["plugin.data"],
      collections: {},
      surfaces: [{ kind: "widget", fn: "widget", title: "Registry test" }],
    });
    const artifact = createPluginBundle(manifest, [
      { path: "main.typ", text: "#let widget(ctx) = [test]" },
    ]);

    const published = await publishPlugin(session as unknown as OAuthSession, did, {
      slug,
      manifest,
      artifact,
      service: service!,
    });
    expect(published.listingUri).toBe(listingUri);

    const resolved = await resolvePlugin(listingUri, { service: service! });
    expect(resolved.release.version).toBe("0.0.1");
    expect(new TextDecoder().decode(resolved.artifact)).toBe(new TextDecoder().decode(artifact));
    expect(resolved.manifest).toMatchObject({ id: listingUri, name: "Registry test" });

    const catalog = await listPublisherPlugins(did, service!);
    expect(catalog.some((entry) => entry.uri === listingUri)).toBe(true);
  }, 60_000);
});
