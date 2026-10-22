/** Canonical URL for a site path, with the trailing slash on the root. */
export function absoluteUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");

  return path === "/" ? `${base}/` : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Link from a page at `root` (its relative prefix) to another site path. */
export function relativeUrl(root: string, target: string): string {
  if (target === "/") return root;

  return `${root}${target.replace(/^\//, "")}`;
}
