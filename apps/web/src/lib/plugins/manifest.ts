import type {
  PluginAction,
  PluginCapability,
  PluginCollectionSchema,
  PluginFieldType,
  PluginManifest,
  PluginPatch,
  PluginPatchOp,
  PluginSurface,
  PluginSurfaceKind,
} from "@typbase/typing";

import { PLUGIN_API } from "@typbase/typing";

// Exact records, not Sets: adding a member to the typing unions breaks the
// build here until the validator knows about it.
const CAPABILITIES: Record<PluginCapability, true> = {
  "pages.read": true,
  "pages.create": true,
  "pages.write": true,
  "daily.write": true,
  "plugin.data": true,
  "plugin.ai": true,
  "ui.external": true,
};

const SURFACES: Record<PluginSurfaceKind, true> = {
  sidebar: true,
  main: true,
  overlay: true,
};

const FIELD_TYPES: Record<PluginFieldType, true> = {
  string: true,
  number: true,
  boolean: true,
  datetime: true,
  json: true,
};

/** `local:calendar` -> `local-calendar`; safe for Typst virtual paths. */
export function pluginSlug(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "plugin";
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`plugin manifest is missing "${field}"`);
  }

  return value;
}

/** Entry modules stay inside the plugin folder and import as Typst. */
function safeEntry(value: unknown): string {
  const entry = requireString(value, "entry");
  if (!/^[\w./-]+\.typ$/.test(entry) || entry.startsWith("/") || entry.includes("..")) {
    throw new Error(`unsafe plugin entry "${entry}"`);
  }

  return entry;
}

/** Exported function names are plain Typst identifiers. */
function safeFunctionName(value: unknown, field: string): string {
  const name = requireString(value, field);
  if (!/^[a-z][\w-]*$/.test(name)) throw new Error(`unsafe function name "${name}" in "${field}"`);

  return name;
}

function parseSurface(raw: unknown, index: number): PluginSurface {
  if (!raw || typeof raw !== "object") throw new Error(`surface ${index} is not an object`);

  const value = raw as Record<string, unknown>;
  const kind = requireString(value.kind, `surfaces[${index}].kind`) as PluginSurfaceKind;
  if (!Object.hasOwn(SURFACES, kind))
    throw new Error(`surface ${index} has unknown kind "${kind}"`);

  return {
    kind,
    fn: safeFunctionName(value.fn, `surfaces[${index}].fn`),
    title: requireString(value.title, `surfaces[${index}].title`),
    icon: typeof value.icon === "string" && value.icon ? value.icon : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
  };
}

function parseCollection(raw: unknown, name: string): PluginCollectionSchema {
  if (!raw || typeof raw !== "object") throw new Error(`collection "${name}" is not an object`);

  const value = raw as Record<string, unknown>;
  const fields: Record<string, { type: PluginFieldType; optional?: boolean }> = {};
  for (const [field, schema] of Object.entries((value.fields as object) ?? {})) {
    const entry = schema as Record<string, unknown>;
    const type = requireString(
      entry.type,
      `collection "${name}" field "${field}"`,
    ) as PluginFieldType;
    if (!Object.hasOwn(FIELD_TYPES, type)) {
      throw new Error(`collection "${name}" field "${field}" has unknown type "${type}"`);
    }
    fields[field] = { type, optional: entry.optional === true };
  }

  return {
    fields,
    searchable: Array.isArray(value.searchable)
      ? value.searchable.filter((field): field is string => typeof field === "string")
      : undefined,
  };
}

/** Validates an untrusted manifest (file or record) into the typed shape. */
export function parseManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") throw new Error("plugin manifest is not an object");

  const value = raw as Record<string, unknown>;
  const api = requireString(value.api, "api");
  if (api !== PLUGIN_API) throw new Error(`unsupported plugin api "${api}" (need ${PLUGIN_API})`);

  const capabilities: PluginCapability[] = [];
  for (const capability of (value.capabilities as unknown[]) ?? []) {
    if (typeof capability !== "string" || !Object.hasOwn(CAPABILITIES, capability)) {
      throw new Error(`unknown capability "${String(capability)}"`);
    }
    capabilities.push(capability as PluginCapability);
  }

  const collections: Record<string, PluginCollectionSchema> = {};
  for (const [name, schema] of Object.entries((value.collections as object) ?? {})) {
    collections[name] = parseCollection(schema, name);
  }

  const surfaces = ((value.surfaces as unknown[]) ?? []).map(parseSurface);
  if (surfaces.length === 0) throw new Error("plugin declares no surfaces");

  return {
    id: requireString(value.id, "id"),
    name: requireString(value.name, "name"),
    version: requireString(value.version, "version"),
    description: typeof value.description === "string" ? value.description : undefined,
    api,
    entry: safeEntry(value.entry),
    icon: typeof value.icon === "string" ? value.icon : undefined,
    capabilities,
    collections,
    surfaces,
    hostComponents: Array.isArray(value.hostComponents)
      ? value.hostComponents.filter((name): name is string => typeof name === "string")
      : undefined,
  };
}

function fieldMatches(type: PluginFieldType, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "datetime":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value);
    case "json":
      return value !== undefined;
    default:
      return false;
  }
}

/**
 * Filters a plugin-supplied patch to declared collections and typed fields.
 * Dropped ops are reported; the caller keeps the errors for the lab.
 */
export function validatePatch(
  patch: PluginPatch,
  manifest: PluginManifest,
): { patch: PluginPatch; errors: string[] } {
  const errors: string[] = [];
  const ops: PluginPatchOp[] = [];

  const cleanRecord = (
    collection: string,
    record: Record<string, unknown>,
  ): Record<string, unknown> => {
    const schema = manifest.collections[collection];
    if (!schema) {
      errors.push(`collection "${collection}" is not declared`);
      return {};
    }

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const field = schema.fields[key];
      if (!field) {
        errors.push(`field "${collection}.${key}" is not declared`);
        continue;
      }
      if (!fieldMatches(field.type, value)) {
        errors.push(`field "${collection}.${key}" is not a ${field.type}`);
        continue;
      }
      clean[key] = value;
    }

    return clean;
  };

  for (const op of patch.state ?? []) {
    if (!op || typeof op !== "object") continue;

    if (op.op === "append") {
      if (!manifest.collections[op.collection]) {
        errors.push(`collection "${op.collection}" is not declared`);
        continue;
      }
      if (typeof op.record?.id !== "string" || !op.record.id) {
        errors.push(`append into "${op.collection}" has no record id`);
        continue;
      }
      const record = cleanRecord(op.collection, op.record);
      ops.push({ ...op, record: { ...record, id: op.record.id } });
      continue;
    }

    const schema =
      typeof op.collection === "string" ? manifest.collections[op.collection] : undefined;
    if (!schema) {
      errors.push(`collection "${String(op.collection)}" is not declared`);
      continue;
    }

    if (typeof op.id !== "string" || !op.id) {
      errors.push(`${op.op} in "${op.collection}" has no record id`);
      continue;
    }

    if (op.op === "set" || op.op === "inc") {
      const field = schema.fields[op.key];
      if (!field) {
        errors.push(`field "${op.collection}.${op.key}" is not declared`);
        continue;
      }
      const value = op.value;
      if (!fieldMatches(field.type, value)) {
        errors.push(`field "${op.collection}.${op.key}" is not a ${field.type}`);
        continue;
      }
      ops.push(op);
      continue;
    }

    if (op.op === "merge") {
      ops.push({ ...op, record: cleanRecord(op.collection, op.record) });
      continue;
    }

    if (op.op === "remove") {
      ops.push(op);
    }
  }

  const view = patch.view && typeof patch.view === "object" ? patch.view : undefined;

  return { patch: { state: ops, view }, errors };
}

/** Human label for an action, used in the lab log. */
export function actionLabel(action: PluginAction): string {
  return `${action.name}${Object.keys(action.args ?? {}).length ? " " + JSON.stringify(action.args) : ""}`;
}
