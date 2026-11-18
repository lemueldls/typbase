/**
 * App shell routing. The workspace lives in the path so a reload or a pasted
 * link resolves the same local workspace. Page, mode, and pane state stay in
 * the query because they describe how the workspace is shown.
 */

/** Device-local key for the workspace opened last, used by the root alias. */
export const LAST_WORKSPACE_KEY = "typbase:lastWorkspace";

/** Canonical workspace path. */
export function workspacePath(id: string): string {
  return `/w/${encodeURIComponent(id)}`;
}

/** Workspace id in a pathname, or "" for the root and unrelated paths. */
export function workspaceIdFromPath(path: string): string {
  const match = /^\/w\/([^/]+)\/?$/.exec(path);
  if (!match?.[1]) return "";

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/** True for the app shell's paths: the root alias and `/w/<id>`. */
export function isWorkspaceLocation(path: string): boolean {
  return path === "/" || /^\/w\/[^/]+\/?$/.test(path);
}

/** Workspace opened last on this device. */
export function lastWorkspaceId(): string {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Workspace id encoded in the current address. */
export function workspaceIdFromLocation(): string {
  if (typeof window === "undefined") return "";

  return workspaceIdFromPath(window.location.pathname);
}
