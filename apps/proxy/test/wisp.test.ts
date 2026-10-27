import { afterEach, describe, expect, it, vi } from "vitest";

import wispRoute from "../routes/wisp/[...path]";

function call(path: string, init?: RequestInit) {
  const url = new URL(`/wisp${path}`, "https://proxy.test");
  return (wispRoute as any)({ req: new Request(url, init), url });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Wisp domain proxy", () => {
  it("answers a preflight without contacting Wisp", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call("/place.wisp.v2.domain.claim", {
      method: "OPTIONS",
      headers: {
        origin: "https://typbase.at",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the claim body and authorization to Wisp", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ domain: "docs.typbase.at" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await call("/place.wisp.v2.domain.claim", {
      method: "POST",
      headers: {
        authorization: "Bearer service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ domain: "docs.typbase.at", siteRkey: "site" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ domain: "docs.typbase.at" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://wisp.place/xrpc/place.wisp.v2.domain.claim"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        body: JSON.stringify({ domain: "docs.typbase.at", siteRkey: "site" }),
      }),
    );

    const init = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect((init.headers as Headers).get("authorization")).toBe("Bearer service-token");
  });

  it("passes the status query through", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await call("/place.wisp.v2.domain.getStatus?domain=docs.typbase.at", {
      method: "GET",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://wisp.place/xrpc/place.wisp.v2.domain.getStatus?domain=docs.typbase.at"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not proxy an unlisted XRPC method", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await call("/place.wisp.v2.fs.put", { method: "POST" }).catch(
      (cause: any) => cause,
    );

    expect(error.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
