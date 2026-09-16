/**
 * Browser stand-in for `node:dns/promises` (aliased in `nuxt.config.ts`).
 * airspace probes that module for TXT lookup and treats a falsy `resolveTxt`
 * as "no Node DNS here", then falls back to DNS over HTTPS. Vite's
 * browser-external stub throws on property access instead, which would kill
 * handle resolution before the fallback runs.
 */
export const resolveTxt = undefined;
