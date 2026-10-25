import { afterEach, describe, expect, it, vi } from "vitest";

import { takeOAuthCallback } from "../src/lib/oauthCallback";

afterEach(() => vi.unstubAllGlobals());

describe("OAuth callback capture", () => {
  it("takes and clears a complete callback", () => {
    const scope = { __typbaseOauthCallback: "state=state-1&code=code-1" };
    vi.stubGlobal("window", scope);

    const params = takeOAuthCallback();

    expect(params?.get("state")).toBe("state-1");
    expect(params?.get("code")).toBe("code-1");
    expect(scope.__typbaseOauthCallback).toBeUndefined();
  });

  it("ignores a callback without a code or error", () => {
    vi.stubGlobal("window", { __typbaseOauthCallback: "state=state-1" });

    expect(takeOAuthCallback()).toBeNull();
  });
});
