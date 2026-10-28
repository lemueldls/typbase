import { defineHandler } from "nitro";

export default defineHandler(() => ({ ok: true, service: "typbase-registry" }));
