/**
 * airspace reads `node:dns/promises` to resolve handles over DNS TXT when
 * running on Node, and falls back to DNS-over-HTTPS in the browser. This
 * package has no Node types, so declare the one function airspace touches.
 */
declare module "node:dns/promises" {
  export function resolveTxt(name: string): Promise<string[][]>;
}
