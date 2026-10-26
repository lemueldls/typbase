/**
 * Browser build of `node:process` for unifont. Its browser path only reads
 * proxy environment variables, and a browser has none, so an empty env keeps
 * the Node proxy dispatcher out of the bundle.
 */
export const env: Record<string, string | undefined> = {};
export const platform = "";
export const versions = {};
export default { env, platform, versions };
