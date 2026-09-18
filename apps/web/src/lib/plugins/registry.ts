import { ref } from "vue";

/**
 * Host-side lookup for plugin Typst modules. Notes import plugin sources
 * through the normal Typst request channel (`#import "/typbase/plugin/..."`),
 * so the resolved catalog is kept here where `typstRequests` can serve it.
 * The plugins composable repopulates it on every catalog refresh.
 */

const sources = new Map<string, string>();

/** Bumped when plugin sources or plugin data change; open editors recompile. */
export const pluginsRevision = ref(0);

export function registerPluginSources(entries: Array<{ path: string; text: string }>): void {
  sources.clear();
  for (const entry of entries) sources.set(entry.path, entry.text);
}

export function getPluginSource(path: string): string | undefined {
  return sources.get(path) ?? sources.get(path.startsWith("/") ? path : `/${path}`);
}

export function bumpPluginsRevision(): void {
  pluginsRevision.value += 1;
}

// Remote edits to plugin docs must refresh notes that embed plugin data.
if (typeof window !== "undefined") {
  window.addEventListener("typbase:imported", (event) => {
    const detail = (event as CustomEvent<string[]>).detail ?? [];
    if (detail.some((docId) => docId.startsWith("plugin:"))) bumpPluginsRevision();
  });
}
