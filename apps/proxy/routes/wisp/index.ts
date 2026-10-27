import { defineHandler } from "nitro";

export default defineHandler(() => ({
  name: "typbase-wisp-proxy",
  description: "Forward Wisp's domain XRPC calls that its CORS policy blocks.",
  endpoints: [
    "place.wisp.v2.domain.claim",
    "place.wisp.v2.domain.claimSubdomain",
    "place.wisp.v2.domain.addSite",
    "place.wisp.v2.domain.delete",
    "place.wisp.v2.domain.getList",
    "place.wisp.v2.domain.getStatus",
    "place.wisp.v2.site.delete",
  ].map((nsid) => ({ route: `/wisp/${nsid}` })),
}));
