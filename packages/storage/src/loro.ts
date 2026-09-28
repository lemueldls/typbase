/**
 * Loro is a wasm package. Load it lazily so the Nuxt server build never
 * touches it.
 */
export type LoroModule = typeof import("loro-crdt");

let loroPromise: Promise<LoroModule> | undefined;

export function loadLoro(): Promise<LoroModule> {
  loroPromise ??= import("loro-crdt");

  return loroPromise;
}
