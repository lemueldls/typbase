/**
 * The host-owned components a plugin surface may mount, by the name it puts in
 * `data-tb-component`.
 */
export const HOST_COMPONENTS = ["canvas"] as const;

export type HostComponentName = (typeof HOST_COMPONENTS)[number];

const KNOWN = new Set<string>(HOST_COMPONENTS);

export function isHostComponent(name: string): name is HostComponentName {
  return KNOWN.has(name);
}

/** Names in `hostComponents` the host does not implement, in manifest order. */
export function unknownHostComponents(names: readonly string[] | undefined): string[] {
  if (!names) return [];

  return names.filter((name) => !KNOWN.has(name));
}
