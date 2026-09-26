/**
 * Plugin protocol types. A plugin is a Typst package plus a manifest plus a
 * data schema; the host compiles its surfaces to sandboxed HTML and applies
 * the patches the render returns. These shapes are what the app, the storage
 * layer, and (later) atproto records all speak.
 *
 * One `PluginInstance` owns one data doc and contributes every surface its
 * manifest declares, so a calendar's sidebar widget and its pane read the
 * same events. Installing a plugin twice gives two independent instances.
 */

import type { Category, PageMeta } from "./index";

/** Capabilities a plugin may ask for. The host enforces them per action. */
export type PluginCapability =
  | "pages.read"
  | "pages.create"
  | "pages.write"
  | "daily.write"
  | "plugin.data"
  | "plugin.ai"
  | "ui.external";

/**
 * Where a surface renders: a sidebar widget, the main pane, or a floating
 * window. One instance may declare all three.
 */
export type PluginSurfaceKind = "widget" | "pane" | "window";

export interface PluginSurface {
  kind: PluginSurfaceKind;
  /** Exported Typst function called with the JSON context. */
  fn: string;
  title: string;
  /** Material Symbol name. */
  icon?: string;
}

export type PluginFieldType = "string" | "number" | "boolean" | "datetime" | "json";

export interface PluginFieldSchema {
  type: PluginFieldType;
  optional?: boolean;
}

export interface PluginCollectionSchema {
  fields: Record<string, PluginFieldSchema>;
  /** Field names copied into the workspace search index. */
  searchable?: string[];
}

export interface PluginManifest {
  /** `local:<slug>` or an atproto URI (`at://did/.../plugin/<slug>`). */
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Host protocol version; only `typbase.host.v2` is accepted. */
  api: string;
  /** Entry module, relative to the plugin root, e.g. `main.typ`. */
  entry: string;
  icon?: string;
  capabilities: PluginCapability[];
  collections: Record<string, PluginCollectionSchema>;
  /** At most one of each kind; each renders for every instance. */
  surfaces: PluginSurface[];
  /** Host components the surface may mount (canvas, board, ...). */
  hostComponents?: string[];
}

/** Installation record in the workspace doc's `plugins` map. */
export interface PluginInstall {
  id: string;
  version: string;
  enabled: boolean;
  /** How the source was installed: `bundled` or a folder label. */
  source: string;
  installedAt: number;
  /** Manifest JSON, cached so the UI works before sources load. */
  manifest: string;
}

/** One plugin instance in the workspace doc's `instances` map. */
export interface PluginInstance {
  id: string;
  pluginId: string;
  title: string;
  /** Material Symbol name; empty means the manifest icon or a default. */
  icon: string;
  /** Plugin-owned instance config as JSON. */
  config: string;
  createdAt: number;
}

/** A rendered document inside one plugin collection. */
export type PluginRecord = Record<string, unknown> & { id: string };

/** Collection name -> records, the shape plugins read off `ctx.state`. */
export type PluginState = Record<string, PluginRecord[]>;

/** One mutation to a plugin collection. The host validates fields first. */
export type PluginPatchOp =
  | { op: "append"; collection: string; record: PluginRecord }
  | { op: "set"; collection: string; id: string; key: string; value: unknown }
  | { op: "merge"; collection: string; id: string; record: Record<string, unknown> }
  | { op: "inc"; collection: string; id: string; key: string; value: number }
  | { op: "remove"; collection: string; id: string };

/**
 * What the plugin's render returns alongside its HTML. `state` mutates the
 * synced plugin doc; `view` shallow-merges into device-local view state (open
 * month, revealed card, ...). Both are applied before the post-action render.
 */
export interface PluginPatch {
  state?: PluginPatchOp[];
  view?: Record<string, unknown>;
}

/** An action dispatched from plugin HTML or built-ins in the host. */
export interface PluginAction {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Form field values collected from the surface. */
  fields?: Record<string, unknown>;
}

/** The result of the host action a render was triggered by, when one was. */
export interface PluginActionResult {
  action: string;
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

/** The JSON document injected at `/typbase/plugin/ctx.json`. */
export interface PluginContext {
  plugin: { id: string; name: string; version: string };
  instance: { id: string; title: string };
  /** Which surface this render is for. */
  surface: { kind: PluginSurfaceKind; title: string };
  locale: string;
  /** ISO-8601 instant and date, fixed for the whole render. */
  now: string;
  today: string;
  config: Record<string, unknown>;
  state: PluginState;
  view: Record<string, unknown>;
  action: (PluginAction & { fields: Record<string, unknown> }) | null;
  /** Set when the last action was a host action. */
  result: PluginActionResult | null;
  /** The page open in the shell, when one is. */
  page: { id: string } | null;
  /** App data, gated by the `pages.read` capability. */
  data: {
    pages: PageMeta[];
    categories: Category[];
    daily: PageMeta[];
  } | null;
  /** Resolved theme tokens under their camelCase palette names. */
  theme: Record<string, string>;
}

/** Host protocol version plugins must declare. */
export const PLUGIN_API = "typbase.host.v2";
