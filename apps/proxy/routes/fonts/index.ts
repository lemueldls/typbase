import { defineHandler } from "nitro";

import { endpoints } from "../../lib/endpoints";

export default defineHandler(() => {
  return {
    name: "typbase-font-proxy",
    description: "Read-only proxy for the font APIs unifont talks to.",
    status: "experimental",
    documentation: "https://unifont.dev/docs/proxy",
    endpoints: endpoints.map((endpoint) => ({
      route: endpoint.route,
      query: endpoint.allowQuery ?? [],
      maxAge: endpoint.maxAge,
    })),
  };
});
