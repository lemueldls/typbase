import { defineHandler } from "nitro";

export default defineHandler(() => ({
  name: "typbase-proxy",
  description: "Live relay and read-only font API proxy for Typbase.",
  endpoints: {
    relay: "/relay",
    fonts: "/fonts",
    health: "/health",
  },
}));
