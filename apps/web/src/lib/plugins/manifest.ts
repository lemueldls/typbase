import type {
  PluginCapability,
  PluginCollectionSchema,
  PluginFieldSchemaMap,
  PluginFieldType,
  PluginManifest,
  PluginPatch,
  PluginPatchOp,
  PluginSurface,
  PluginSurfaceKind,
} from "@typbase/typing";

import { PLUGIN_API } from "@typbase/typing";

import { HOST_COMPONENTS, unknownHostComponents } from "./hostComponents";

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
  widget: true,
  pane: true,
  window: true,
};

const FIELD_TYPES: Record<PluginFieldType, true> = {
  string: true,
  number: true,
  boolean: true,
  datetime: true,
  json: true,
};

/** Id scheme for a plugin that ships in the bundle or in `plugins/<slug>/`. */
export const LOCAL_ID_PREFIX = "local:";

/** The Typst virtual path segment */
export function pluginSlug(id: string): string {
  const name = id.startsWith(LOCAL_ID_PREFIX) ? id.slice(LOCAL_ID_PREFIX.length) : id;
  const slug = name
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
  };
}

function parseCollection(raw: unknown, name: string): PluginCollectionSchema {
  if (!raw || typeof raw !== "object") throw new Error(`collection "${name}" is not an object`);

  const value = raw as Record<string, unknown>;
  const fields: PluginFieldSchemaMap = {};
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

  return { fields };
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
  const kinds = new Set<PluginSurfaceKind>();
  for (const surface of surfaces) {
    if (kinds.has(surface.kind)) {
      throw new Error(`plugin declares two ${surface.kind} surfaces; one per kind`);
    }
    kinds.add(surface.kind);
  }

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
    hostComponents: parseHostComponents(value.hostComponents),
  };
}

/**
 * An unimplemented component name is an authoring mistake, so it fails while the
 * manifest is being validated rather than leaving the surface quietly without
 * the component it asked for.
 */
function parseHostComponents(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const names = raw.filter((name): name is string => typeof name === "string");
  const unknown = unknownHostComponents(names);
  if (unknown.length) {
    throw new Error(
      `hostComponents names no such component: ${unknown.join(", ")} (available: ${HOST_COMPONENTS.join(", ")})`,
    );
  }

  return names;
}

/**
 * Whether a value is acceptable for a field, and why not when it is not.
 */
function fieldVerdict(
  field: { type: PluginFieldType; optional?: boolean },
  value: unknown,
): { ok: true } | { ok: false; message: string } {
  if (value === undefined) {
    return field.optional ? { ok: true } : { ok: false, message: "is required but was not given" };
  }

  const type = field.type;
  const ok =
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "datetime" &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value)) ||
    // `json` takes anything the record can hold, including null and arrays.
    type === "json";

  return ok ? { ok: true } : { ok: false, message: `is not a ${type}` };
}

/**
 * Filters a plugin-supplied patch to declared collections and typed fields.
 * Dropped ops are reported. The caller keeps the errors for the lab.
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
    /** `append` builds a whole record, so it is also checked for completeness. */
    requireComplete: boolean,
  ): Record<string, unknown> => {
    const schema = manifest.collections[collection];
    if (!schema) {
      errors.push(`collection "${collection}" is not declared`);
      return {};
    }

    const clean: Record<string, unknown> = {};
    const mentioned = new Set<string>();
    for (const [key, value] of Object.entries(record)) {
      // `id` is the record key, added by the runtime. Schemas never declare it.
      if (key === "id") continue;

      const field = schema.fields[key];
      if (!field) {
        errors.push(`field "${collection}.${key}" is not declared`);
        continue;
      }
      mentioned.add(key);

      if (value === undefined && !requireComplete) continue;

      const verdict = fieldVerdict(field, value);
      if (!verdict.ok) {
        errors.push(`field "${collection}.${key}" ${verdict.message}`);
        continue;
      }
      if (value !== undefined) clean[key] = value;
    }

    if (requireComplete) {
      for (const [key, field] of Object.entries(schema.fields)) {
        if (field.optional || mentioned.has(key)) continue;
        errors.push(`field "${collection}.${key}" is required but was not given`);
      }
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
      const record = cleanRecord(op.collection, op.record, true);
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
      const verdict = fieldVerdict(field, op.value);
      if (!verdict.ok) {
        errors.push(`field "${op.collection}.${op.key}" ${verdict.message}`);
        continue;
      }
      ops.push(op);
      continue;
    }

    if (op.op === "merge") {
      ops.push({ ...op, record: cleanRecord(op.collection, op.record, false) });
      continue;
    }

    if (op.op === "remove") {
      ops.push(op);
    }
  }

  const view = patch.view && typeof patch.view === "object" ? patch.view : undefined;

  return { patch: { state: ops, view }, errors };
}
