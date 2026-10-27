import { defineHandler, HTTPError } from "nitro";
import { assertMethod, isPreflightRequest, noContent } from "nitro/h3";

const WISP_BASE = "/wisp";
const WISP_ORIGIN = "https://wisp.place";

const ALLOWED = new Set([
  "place.wisp.v2.domain.claim",
  "place.wisp.v2.domain.claimSubdomain",
  "place.wisp.v2.domain.addSite",
  "place.wisp.v2.domain.delete",
  "place.wisp.v2.domain.getList",
  "place.wisp.v2.domain.getStatus",
  "place.wisp.v2.site.delete",
]);

export default defineHandler(async (event) => {
  if (isPreflightRequest(event)) return noContent();

  assertMethod(event, ["GET", "POST"]);

  const nsid = event.url.pathname.slice(WISP_BASE.length).replace(/^\/+/, "");
  if (!ALLOWED.has(nsid)) {
    throw new HTTPError({
      status: 404,
      message: `No Wisp proxy endpoint for \`${event.url.pathname}\`.`,
    });
  }

  const target = new URL(`/xrpc/${nsid}${event.url.search}`, WISP_ORIGIN);
  const headers = new Headers();
  const authorization = event.req.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  const contentType = event.req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const response = await fetch(target, {
    method: event.req.method,
    headers,
    body: event.req.method === "POST" ? await event.req.text() : undefined,
    signal: event.req.signal,
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
});
