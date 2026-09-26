<script setup lang="ts">
import type { PluginPatchOp, PluginSurfaceKind } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import type { PluginError } from "~/composables/plugins";

import PluginCodeEditor from "~/components/studio/PluginCodeEditor.vue";
import { parseManifest, pluginSlug } from "~/lib/plugins/manifest";

// The studio is a client tool: it needs storage and the catalog, and SSR only
// adds a hydration race for the plugin list.
definePageMeta({ ssr: false });

/**
 * Plugin studio. Pick a plugin, edit its sources with validation, preview
 * each declared surface, dispatch actions, and inspect state, view, and logs.
 * Local plugins under `plugins/<slug>/` are read and written through the
 * storage backend; bundled plugins are read-only until forked.
 */
const plugins = usePlugins();
const { backend, workspace, ensure, dataRevision } = useWorkspace();
const route = useRoute();
const router = useRouter();

const selectedPluginId = ref(typeof route.query.plugin === "string" ? route.query.plugin : "");
const selectedInstanceId = ref("");
const tab = ref<"preview" | "source" | "data" | "logs">("preview");
const previewSurface = ref<PluginSurfaceKind>("pane");

const selected = computed(() =>
  plugins.catalog.value.find((entry) => entry.manifest.id === selectedPluginId.value),
);
const instances = computed(() =>
  plugins.instances.value.filter((instance) => instance.pluginId === selectedPluginId.value),
);
const installed = computed(() =>
  plugins.installs.value.find((install) => install.id === selectedPluginId.value),
);
const engineMode = computed(() => plugins.engine.mode);

interface StudioFile {
  /** Path relative to the plugin root. */
  name: string;
  kind: "manifest" | "typst" | "css";
  text: string;
}

// Refs live above the immediate watchers; the load and inspect functions
// below fill them.
const files = ref<StudioFile[]>([]);
const selectedFile = ref("");
const draft = ref("");
const dirty = ref(false);
const saveMessage = ref("");
const saveError = ref("");
const stateJson = ref("{}");
const viewJson = ref("{}");
const dataError = ref("");

onMounted(() => void ensure());

watch(selectedPluginId, (id) => {
  if (id && route.query.plugin !== id) void router.replace({ query: { plugin: id } });
  void loadFiles();
});

watch(
  instances,
  (list) => {
    if (!list.some((candidate) => candidate.id === selectedInstanceId.value)) {
      selectedInstanceId.value = list[0]?.id ?? "";
    }
  },
  { immediate: true },
);

watch(
  selectedInstanceId,
  () => {
    const kinds = plugins.surfacesOf(selectedInstanceId.value).map((surface) => surface.kind);
    if (kinds.length && !kinds.includes(previewSurface.value)) previewSurface.value = kinds[0]!;
    void refreshData();
  },
  { immediate: true },
);

// A catalog refresh, install, or source edit invalidates the file list.
watch([selected, () => plugins.installs.value.length], () => void loadFiles(), {
  immediate: true,
});

const currentFile = computed(() => files.value.find((file) => file.name === selectedFile.value));

const editor = useTemplateRef<{ revealLine: (line: number) => void }>("editor");

function relativeSource(entry: NonNullable<typeof selected.value>, path: string): string {
  const prefix = `/typbase/plugin/${entry.slug}/`;

  return path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\//, "");
}

/** Clicking an error with a mapped file opens that file at its line. */
async function revealError(error: PluginError): Promise<void> {
  const entry = selected.value;
  if (!entry || !error.file) return;

  const name = relativeSource(entry, error.file);
  if (!files.value.some((file) => file.name === name)) return;

  selectedFile.value = name;
  tab.value = "source";
  await nextTick();
  if (error.line) editor.value?.revealLine(error.line);
}

function errorSite(error: PluginError): string {
  if (!error.file || !selected.value) return "";
  return `${relativeSource(selected.value, error.file)}:${error.line ?? 1}`;
}

async function readStoredFile(dir: string, name: string): Promise<string | null> {
  const bytes = await backend.value?.read(`${dir}/${name}`).catch(() => null);

  return bytes ? new TextDecoder().decode(bytes) : null;
}

async function loadFiles(): Promise<void> {
  const entry = selected.value;
  if (!entry) {
    files.value = [];
    return;
  }

  const next: StudioFile[] = [];
  const manifestText = entry.storageDir
    ? await readStoredFile(entry.storageDir, "plugin.json")
    : null;
  next.push({
    name: "plugin.json",
    kind: "manifest",
    text: manifestText ?? `${JSON.stringify(entry.manifest, null, 2)}\n`,
  });

  for (const source of entry.sources) {
    next.push({ name: relativeSource(entry, source.path), kind: "typst", text: source.text });
  }
  for (const style of entry.styles) {
    next.push({ name: style.name, kind: "css", text: style.text });
  }

  // Local files can change on disk; prefer stored bytes over the catalog copy.
  if (entry.storageDir) {
    for (const file of next) {
      const stored = await readStoredFile(entry.storageDir, file.name);
      if (stored !== null) file.text = stored;
    }
  }

  files.value = next;
  if (!next.some((file) => file.name === selectedFile.value)) {
    selectedFile.value = next[0]?.name ?? "";
    dirty.value = false;
  } else if (!dirty.value) {
    // A reload (save, external edit) refreshes the open file in place; an
    // in-progress edit keeps its draft.
    draft.value = next.find((file) => file.name === selectedFile.value)?.text ?? "";
  }
}

watch(selectedFile, () => {
  draft.value = currentFile.value?.text ?? "";
  dirty.value = false;
  saveMessage.value = "";
  saveError.value = "";
});

watch(draft, () => {
  if (draft.value !== currentFile.value?.text) dirty.value = true;
});

async function saveFile(): Promise<void> {
  const entry = selected.value;
  const file = currentFile.value;
  saveError.value = "";
  saveMessage.value = "";
  if (!entry || !file) return;

  if (!entry.storageDir || !backend.value) {
    saveError.value = "Bundled plugins are read-only. Fork it to edit.";
    return;
  }

  if (file.kind === "manifest") {
    try {
      parseManifest(JSON.parse(draft.value) as unknown);
    } catch (error) {
      saveError.value = `Invalid manifest: ${error instanceof Error ? error.message : error}`;
      return;
    }
  }

  await backend.value.write(
    `${entry.storageDir}/${file.name}`,
    new TextEncoder().encode(draft.value),
  );
  file.text = draft.value;
  dirty.value = false;
  saveMessage.value = `Saved ${file.name}`;
  await plugins.refreshCatalog();
  await loadFiles();
}

/** Copies a bundled plugin into `plugins/<slug>/` so it can be edited. */
async function forkToLocal(): Promise<void> {
  const entry = selected.value;
  const active = backend.value;
  if (!entry || !active || entry.storageDir) return;

  for (const file of files.value) {
    await active.write(
      `${`plugins/${entry.slug}`}/${file.name}`,
      new TextEncoder().encode(file.text),
    );
  }

  await plugins.refreshCatalog();
  saveMessage.value = `Copied to plugins/${entry.slug}/`;
  await loadFiles();
}

const newOpen = ref(false);
const newName = ref("");

const TEMPLATE_MANIFEST = (name: string, id: string) =>
  `${JSON.stringify(
    {
      id,
      name,
      version: "0.1.0",
      description: "A plugin made in the studio.",
      api: "typbase.host.v2",
      entry: "main.typ",
      icon: "extension",
      capabilities: ["plugin.data"],
      collections: {},
      surfaces: [{ kind: "pane", fn: "pane", title: name, icon: "extension" }],
    },
    null,
    2,
  )}\n`;

const TEMPLATE_MAIN = `// Every surface returns (ui, state, view). The host applies the patch and
// renders once more, so a step only describes the change.
#import "/typbase/ui.typ": *

#let step(state, view, action, ctx) = {
  if action.name == "counter.bump" {
    ops-view((count: view.at("count", default: 0) + 1))
  } else {
    (:)
  }
}

#let pane(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }
  let count = ctx.view.at("count", default: 0)

  surface(
    [
      #panel(title: "Hello", body: [
        #muted(body: "Count: " + str(count))
        #button("Bump", action: "counter.bump", kind: "primary")
      ])
    ],
    ..patch,
  )
}
`;

const TEMPLATE_STYLE = `/* Plugin styles. Host variables (--color-*, --space-*, --text-*, ...) and
   ctx.theme tokens keep this on the workspace palette. */
`;

async function createPlugin(): Promise<void> {
  const name = newName.value.trim();
  const active = backend.value;
  if (!name || !active) return;

  const slug = pluginSlug(`local:${name}`);
  const id = `local:${slug}`;
  const encoder = new TextEncoder();
  await active.write(`plugins/${slug}/plugin.json`, encoder.encode(TEMPLATE_MANIFEST(name, id)));
  await active.write(`plugins/${slug}/main.typ`, encoder.encode(TEMPLATE_MAIN));
  await active.write(`plugins/${slug}/style.css`, encoder.encode(TEMPLATE_STYLE));

  await plugins.refreshCatalog();
  selectedPluginId.value = id;
  selectedFile.value = "main.typ";
  newOpen.value = false;
  newName.value = "";
}

// Data and view inspection

async function refreshData(): Promise<void> {
  const store = workspace.value;
  const id = selectedInstanceId.value;
  dataError.value = "";
  if (!store || !id) {
    stateJson.value = "{}";
    viewJson.value = "{}";
    return;
  }

  try {
    stateJson.value = JSON.stringify(await store.readPluginState(id), null, 2);
  } catch (error) {
    dataError.value = String(error);
  }
  viewJson.value = JSON.stringify(plugins.viewOf(id), null, 2);
}

watch(dataRevision, () => void refreshData());
watch(
  () => plugins.logs.value.length,
  () => void refreshData(),
);

async function clearData(): Promise<void> {
  const store = workspace.value;
  const id = selectedInstanceId.value;
  if (!store || !id) return;
  if (!window.confirm("Delete every record in this instance?")) return;

  const state = await store.readPluginState(id);
  const ops: PluginPatchOp[] = [];
  for (const [collection, records] of Object.entries(state)) {
    for (const record of records) ops.push({ op: "remove", collection, id: record.id });
  }
  if (ops.length) await store.applyPluginPatch(id, ops);
  await plugins.renderInstance(id, previewSurface.value);
  await refreshData();
}

function resetView(): void {
  if (!selectedInstanceId.value) return;
  plugins.resetView(selectedInstanceId.value);
  void plugins.renderInstance(selectedInstanceId.value, previewSurface.value);
  viewJson.value = "{}";
}

// Action dispatch

const actionName = ref("");
const actionArgs = ref("{}");
const actionFields = ref("{}");
const actionStatus = ref("");

async function dispatchAction(): Promise<void> {
  const id = selectedInstanceId.value;
  actionStatus.value = "";
  if (!id || !actionName.value.trim()) return;

  let args: Record<string, unknown> = {};
  let fields: Record<string, unknown> = {};
  try {
    args = actionArgs.value.trim() ? (JSON.parse(actionArgs.value) as Record<string, unknown>) : {};
  } catch (error) {
    actionStatus.value = `args: ${String(error)}`;
    return;
  }
  try {
    fields = actionFields.value.trim()
      ? (JSON.parse(actionFields.value) as Record<string, unknown>)
      : {};
  } catch (error) {
    actionStatus.value = `fields: ${String(error)}`;
    return;
  }

  actionStatus.value = `dispatched ${actionName.value}`;
  await plugins.dispatch(id, previewSurface.value, {
    id: crypto.randomUUID(),
    name: actionName.value.trim(),
    args,
    fields,
  });
  await refreshData();
}

async function installPlugin(): Promise<void> {
  if (!selectedPluginId.value) return;
  await plugins.install(selectedPluginId.value);
  await refreshData();
}

function openPreview(): void {
  const id = selectedInstanceId.value;
  if (!id) return;
  if (previewSurface.value === "window") plugins.openWindow(id);
  else if (previewSurface.value === "pane") void router.push({ query: { view: `plugin:${id}` } });
}

const pluginLogs = computed(() =>
  plugins.logs.value.filter(
    (entry) => !entry.pluginId || entry.pluginId === selectedPluginId.value,
  ),
);
const pluginErrors = computed(() =>
  selectedPluginId.value ? plugins.errorsFor(selectedPluginId.value) : [],
);

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}
</script>

<template>
  <main class="studio">
    <header class="studio__header">
      <UiIconButton icon="arrow_back" label="Back" variant="ghost" @click="router.push('/')" />
      <h1 class="studio__title">Plugin studio</h1>
      <span class="studio__muted">engine: {{ engineMode }}</span>
      <div class="studio__header-actions">
        <UiButton size="small" variant="ghost" @click="plugins.refreshCatalog()">
          Reload plugins
        </UiButton>
        <UiButton size="small" variant="primary" @click="newOpen = true">New plugin</UiButton>
      </div>
    </header>

    <div class="studio__grid">
      <aside class="studio__sidebar">
        <h2 class="studio__label">Plugins</h2>
        <button
          v-for="entry in plugins.catalog.value"
          :key="entry.manifest.id"
          type="button"
          class="studio__plugin"
          :class="{ 'studio__plugin--active': entry.manifest.id === selectedPluginId }"
          @click="selectedPluginId = entry.manifest.id"
        >
          <MsIcon
            :name="(entry.manifest.icon as MaterialSymbol | undefined) ?? 'extension'"
            :size="16"
          />
          <span class="studio__plugin-name">{{ entry.manifest.name }}</span>
          <span class="studio__muted">{{ entry.source }}</span>
          <span v-if="plugins.errorsFor(entry.manifest.id).length" class="studio__issue-dot" />
        </button>

        <template v-if="selected">
          <h2 class="studio__label">Plugin</h2>
          <p class="studio__muted">{{ selected.manifest.description }}</p>
          <p class="studio__muted">
            v{{ selected.manifest.version }} · {{ selected.manifest.api }}
          </p>

          <div class="studio__row">
            <UiButton v-if="!installed" size="small" variant="primary" @click="installPlugin">
              Install
            </UiButton>
            <template v-else>
              <UiSwitch
                :model-value="installed.enabled"
                aria-label="Enabled"
                @update:model-value="(value) => plugins.setEnabled(selectedPluginId, value)"
              />
              <UiButton size="small" variant="ghost" @click="plugins.addInstance(selectedPluginId)">
                Add instance
              </UiButton>
            </template>
          </div>

          <h2 class="studio__label">Instances</h2>
          <p v-if="!instances.length" class="studio__muted">
            Install the plugin to create an instance.
          </p>
          <UiSelect
            v-else
            v-model="selectedInstanceId"
            :options="instances.map((i) => ({ value: i.id, label: i.title }))"
            label="Instance"
          />
        </template>
      </aside>

      <section v-if="!selected" class="studio__empty">
        <p>Pick a plugin on the left, or create one.</p>
      </section>

      <section v-else class="studio__main">
        <nav class="studio__tabs">
          <button
            v-for="item in ['preview', 'source', 'data', 'logs'] as const"
            :key="item"
            type="button"
            class="studio__tab"
            :class="{ 'studio__tab--active': tab === item }"
            @click="tab = item"
          >
            {{ item }}
            <span v-if="item === 'logs' && pluginLogs.length" class="studio__count">
              {{ pluginLogs.length }}
            </span>
          </button>
        </nav>

        <div v-if="tab === 'preview'" class="studio__panel">
          <div class="studio__row">
            <UiSelect
              v-model="previewSurface"
              :options="
                plugins.surfacesOf(selectedInstanceId).map((surface) => ({
                  value: surface.kind,
                  label: `${surface.kind} · ${surface.fn}`,
                }))
              "
              label="Surface"
              class="studio__select"
            />
            <UiButton
              v-if="previewSurface !== 'widget'"
              size="small"
              :disabled="!selectedInstanceId"
              @click="openPreview"
            >
              Open
            </UiButton>
            <UiButton
              size="small"
              variant="ghost"
              :disabled="!selectedInstanceId"
              @click="plugins.renderInstance(selectedInstanceId, previewSurface)"
            >
              Recompile
            </UiButton>
          </div>

          <div v-if="selectedInstanceId" class="studio__preview">
            <PluginSurface
              :key="`${selectedInstanceId}:${previewSurface}`"
              :instance-id="selectedInstanceId"
              :surface="previewSurface"
            />
          </div>
          <p v-else class="studio__muted">No instance to preview.</p>

          <div class="studio__group">
            <h3 class="studio__label">Dispatch action</h3>
            <UiTextField v-model="actionName" placeholder="action name" />
            <textarea
              v-model="actionArgs"
              rows="3"
              class="studio__textarea"
              placeholder="args JSON"
            />
            <textarea
              v-model="actionFields"
              rows="2"
              class="studio__textarea"
              placeholder="fields JSON"
            />
            <div class="studio__row">
              <UiButton size="small" :disabled="!selectedInstanceId" @click="dispatchAction">
                Dispatch
              </UiButton>
              <span class="studio__muted">{{ actionStatus }}</span>
            </div>
          </div>
        </div>

        <div v-else-if="tab === 'source'" class="studio__panel studio__panel--source">
          <div class="studio__row">
            <UiSelect
              v-model="selectedFile"
              :options="files.map((file) => ({ value: file.name, label: file.name }))"
              label="File"
              class="studio__select"
            />
            <UiButton size="small" variant="primary" :disabled="!dirty" @click="saveFile">
              Save
            </UiButton>
            <UiButton v-if="!selected.storageDir" size="small" @click="forkToLocal">
              Fork to workspace
            </UiButton>
            <span v-if="saveMessage" class="studio__muted">{{ saveMessage }}</span>
            <span v-if="saveError" class="studio__error">{{ saveError }}</span>
          </div>
          <PluginCodeEditor
            ref="editor"
            v-model="draft"
            :language="currentFile?.kind === 'typst' ? 'typst' : 'text'"
            :readonly="!selected.storageDir"
            @save="saveFile"
          />
        </div>

        <div v-else-if="tab === 'data'" class="studio__panel">
          <div class="studio__row">
            <UiButton size="small" variant="ghost" @click="refreshData">Refresh</UiButton>
            <UiButton size="small" :disabled="!selectedInstanceId" @click="resetView">
              Reset view
            </UiButton>
            <UiButton
              size="small"
              class="button--color-danger"
              :disabled="!selectedInstanceId"
              @click="clearData"
            >
              Clear data
            </UiButton>
          </div>
          <p v-if="dataError" class="studio__error">{{ dataError }}</p>
          <h3 class="studio__label">View</h3>
          <pre class="studio__pre">{{ viewJson }}</pre>
          <h3 class="studio__label">State</h3>
          <pre class="studio__pre">{{ stateJson }}</pre>
        </div>

        <div v-else class="studio__panel">
          <div class="studio__row">
            <UiButton size="small" variant="ghost" @click="plugins.clearErrors(selectedPluginId)">
              Clear errors
            </UiButton>
            <UiButton size="small" variant="ghost" @click="plugins.clearLogs()"
              >Clear logs</UiButton
            >
          </div>
          <ul v-if="pluginErrors.length" class="studio__errors">
            <li v-for="(error, index) in pluginErrors" :key="index">
              <button
                type="button"
                class="studio__error studio__error--link"
                :disabled="!error.file"
                @click="revealError(error)"
              >
                <span>{{ error.message }}</span>
                <span v-if="error.file" class="studio__error-site">{{ errorSite(error) }}</span>
              </button>
            </li>
          </ul>
          <ul class="studio__logs">
            <li v-for="(entry, index) in pluginLogs" :key="index" class="studio__log">
              <span class="studio__log-kind studio__log-kind--{{ entry.kind }}">
                {{ entry.kind }}
              </span>
              <span class="studio__muted">{{ formatTime(entry.at) }}</span>
              <span class="studio__log-message">{{ entry.message }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <UiDialog :open="newOpen" title="New plugin" @update:open="newOpen = $event">
      <div class="studio__group">
        <UiTextField v-model="newName" label="Name" placeholder="My plugin" />
        <p class="studio__muted">
          Writes <code>plugins/&lt;slug&gt;/</code> with a manifest, an entry module, and a
          stylesheet.
        </p>
        <div class="studio__row">
          <UiButton
            size="small"
            variant="primary"
            :disabled="!newName.trim()"
            @click="createPlugin"
          >
            Create
          </UiButton>
          <UiButton size="small" @click="newOpen = false">Cancel</UiButton>
        </div>
      </div>
    </UiDialog>
  </main>
</template>

<style>
.studio {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface);
}

.studio__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--pane-header-height);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.studio__title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 650;
}

.studio__header-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  margin-left: auto;
}

.studio__grid {
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}

.studio__sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
}

.studio__plugin {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.studio__plugin:hover {
  background: var(--color-surface-2);
}

.studio__plugin--active {
  background: var(--color-surface-3);
}

.studio__plugin-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio__issue-dot {
  flex: none;
  width: 6px;
  height: 6px;
  background: var(--color-danger);
  border-radius: var(--radius-full);
}

.studio__label {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.studio__muted {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.studio__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.studio__select {
  flex: 1;
  min-width: 12rem;
}

.studio__main {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.studio__tabs {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.studio__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2-5);
  font: inherit;
  font-size: var(--text-md);
  text-transform: capitalize;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.studio__tab:hover {
  background: var(--color-surface-2);
}

.studio__tab--active {
  color: var(--color-text);
  background: var(--color-surface-3);
}

.studio__count {
  padding: 0 var(--space-1);
  font-size: var(--text-2xs);
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
}

.studio__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-height: 0;
  overflow-y: auto;
}

.studio__panel--source {
  height: 100%;
  overflow: hidden;
}

.studio__panel--source .studio-editor {
  flex: 1;
}

.studio__preview {
  height: 26rem;
  overflow: hidden;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.studio__group {
  display: grid;
  gap: var(--space-2);
}

.studio__textarea {
  width: 100%;
  padding: var(--space-1-5) var(--space-2);
  font: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: vertical;
}

.studio__pre {
  max-height: 18rem;
  margin: 0;
  padding: var(--space-2-5);
  overflow: auto;
  font-size: var(--text-xs);
  white-space: pre-wrap;
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.studio__errors {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
}

.studio__error {
  padding: var(--space-1-5) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.studio__error--link {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  border: none;
  cursor: pointer;
}

.studio__error--link:disabled {
  cursor: default;
}

.studio__error-site {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  opacity: 0.8;
}

.studio__logs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
}

.studio__log {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.studio__log-kind {
  flex: none;
  width: 3.6rem;
  font-size: var(--text-2xs);
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.studio__log-kind--error {
  color: var(--color-danger);
}

.studio__log-kind--patch {
  color: var(--color-ok);
}

.studio__log-message {
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio__empty {
  display: grid;
  place-content: center;
  color: var(--color-text-secondary);
}
</style>
