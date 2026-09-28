import { DEFAULT_HANDLE_RESOLVER, nativeClientOptions } from "@typbase/spaces";
import { describe, expect, it } from "vitest";

describe("native OAuth client options", () => {
  // A packaged shell has no PDS configured, and without a resolver the client
  // throws before it can build an authorization URL, which surfaced as an
  // account-not-found error at sign-in.
  it("resolves handles through bsky.social by default", () => {
    const options = nativeClientOptions({
      clientId: "https://typbase.at/oauth-client-metadata/native.json",
      allowHttp: false,
    });

    expect(options.handleResolver).toBe(DEFAULT_HANDLE_RESOLVER);
    expect(options.handleResolver).toBe("https://bsky.social");
    expect(options.responseMode).toBe("fragment");
  });

  it("keeps a configured handle resolver and PLC directory", () => {
    const options = nativeClientOptions({
      clientId: "https://typbase.at/oauth-client-metadata/native.json",
      allowHttp: true,
      handleResolver: "http://localhost:2583",
      plcDirectoryUrl: "http://localhost:2582",
    });

    expect(options.handleResolver).toBe("http://localhost:2583");
    expect(options.plcDirectoryUrl).toBe("http://localhost:2582");
  });
});
