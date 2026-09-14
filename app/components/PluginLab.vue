<script setup lang="ts">
import type { PluginAction } from "@typbase/typing";

const plugins = usePlugins();
const { backend, workspace } = useWorkspace();

const selectedId = ref("");
const selected = computed(() =>
  plugins.instances.value.find((entry) => entry.id === selectedId.value),
);
const previewHtml = ref("");

const actionName = ref("calendar.select");
const actionArgs = ref('{\n  "date": "2026-09-20"\n}');
const actionFields = ref("{}");
const actionStatus = ref("");

const stateJson = ref("");
const htmlPreview = ref("");
const showHtml = ref(false);

async function refreshInspection(): Promise<void> {
  const id = selectedId.value;
  if (!id) {
    stateJson.value = "";
    htmlPreview.value = "";
    return;
  }

  try {
    stateJson.value = JSON.stringify((await workspace.value?.readPluginState(id)) ?? {}, null, 2);
  } catch (error) {
    stateJson.value = String(error);
  }

  previewHtml.value = plugins.htmlOf(id);
  htmlPreview.value = previewHtml.value;
}

watch(selectedId, () => void refreshInspection(), { immediate: true });
watch(
  plugins.instances,
  (list) => {
    if (!selectedId.value && list[0]) selectedId.value = list[0].id;
  },
  { immediate: true },
);
watch(
  () => plugins.logs.value.length,
  () => void refreshInspection(),
);

async function compile(): Promise<void> {
  if (selectedId.value) await plugins.renderInstance(selectedId.value);
  await refreshInspection();
}

function dispatchAction(): void {
  actionStatus.value = "";
  if (!selectedId.value) return;

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

  const action: PluginAction = {
    id: crypto.randomUUID(),
    name: actionName.value.trim(),
    args,
    fields,
  };
  actionStatus.value = `dispatched ${action.name}`;
  void plugins.dispatch(selectedId.value, action).then(() => void refreshInspection());
}

const editPlugin = ref("");
const editFile = ref("");
const editText = ref("");
const editStatus = ref("");
const saving = ref(false);

const localEntries = computed(() =>
  plugins.catalog.value.filter((entry) => entry.source === "local" && entry.storageDir),
);

const editEntry = computed(() =>
  localEntries.value.find((entry) => entry.manifest.id === editPlugin.value),
);

const editFiles = computed(() => {
  const entry = editEntry.value;
  if (!entry) return [];
  const prefix = `/typbase-plugin/${entry.slug}/`;

  return entry.sources
    .map((source) =>
      source.path.startsWith(prefix) ? source.path.slice(prefix.length) : source.path,
    )
    .sort();
});

watch(
  localEntries,
  (list) => {
    if (!editPlugin.value && list[0]) editPlugin.value = list[0].manifest.id;
  },
  { immediate: true },
);
watch(
  editFiles,
  (files) => {
    if (!editFile.value || !files.includes(editFile.value)) editFile.value = files[0] ?? "";
  },
  { immediate: true },
);
watch(editFile, () => void loadSource());

async function loadSource(): Promise<void> {
  const entry = editEntry.value;
  const active = backend.value;
  if (!entry || !active || !editFile.value) {
    editText.value = "";
    return;
  }

  const bytes = await active.read(`${entry.storageDir}/${editFile.value}`).catch(() => null);
  editText.value = bytes ? new TextDecoder().decode(bytes) : "";
}

async function saveSource(): Promise<void> {
  const entry = editEntry.value;
  const active = backend.value;
  if (!entry || !active || !editFile.value) return;

  saving.value = true;
  try {
    await active.write(
      `${entry.storageDir}/${editFile.value}`,
      new TextEncoder().encode(editText.value),
    );
    editStatus.value = `saved ${editFile.value}`;
    await plugins.refreshCatalog();
    await refreshInspection();
  } catch (error) {
    editStatus.value = String(error);
  } finally {
    saving.value = false;
  }
}

/** Copies a bundled plugin into the storage tree so it can be edited. */
async function forkToLocal(pluginId: string): Promise<void> {
  const entry = plugins.catalog.value.find((candidate) => candidate.manifest.id === pluginId);
  const active = backend.value;
  if (!entry || !active) return;

  const prefix = `/typbase-plugin/${entry.slug}/`;
  const encoder = new TextEncoder();
  for (const source of entry.sources) {
    const relative = source.path.startsWith(prefix)
      ? source.path.slice(prefix.length)
      : source.path.replace(/^\//, "");
    await active.write(`plugins/${entry.slug}/${relative}`, encoder.encode(source.text));
  }
  await active.write(
    `plugins/${entry.slug}/plugin.json`,
    encoder.encode(`${JSON.stringify(entry.manifest, null, 2)}\n`),
  );

  await plugins.refreshCatalog();
  editPlugin.value = pluginId;
  editStatus.value = `copied to plugins/${entry.slug}/`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}
</script>

<template>
  <div class="lab-plugin">
    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">Engine</h3>
      <p class="lab-plugin__row">
        <span>
          Mode: <strong>{{ plugins.engine.mode }}</strong> · worker crashes:
          {{ plugins.engine.workerCrashes }}
        </span>
        <button type="button" class="button button--small" @click="plugins.resetEngine()">
          Retry worker
        </button>
      </p>
      <pre v-if="plugins.engine.lastError" class="lab-plugin__error">{{
        plugins.engine.lastError
      }}</pre>
    </section>

    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">Surface</h3>
      <div class="lab-plugin__row">
        <select v-model="selectedId" class="lab-plugin__input">
          <option
            v-for="instance in plugins.instances.value"
            :key="instance.id"
            :value="instance.id"
          >
            {{ instance.title }} ({{ instance.surface }})
          </option>
        </select>
        <button type="button" class="button button--primary button--small" @click="compile">
          Compile
        </button>
        <button type="button" class="button button--small" @click="refreshInspection">
          Refresh state
        </button>
      </div>

      <div class="lab-plugin__action">
        <input v-model="actionName" class="lab-plugin__input" placeholder="action name" />
        <textarea v-model="actionArgs" rows="3" class="lab-plugin__input" placeholder="args JSON" />
        <textarea
          v-model="actionFields"
          rows="2"
          class="lab-plugin__input"
          placeholder="fields JSON"
        />
        <div class="lab-plugin__row">
          <button type="button" class="button button--small" @click="dispatchAction">
            Dispatch action
          </button>
          <span class="lab-plugin__muted">{{ actionStatus }}</span>
        </div>
      </div>
    </section>

    <section v-if="selected" class="lab-plugin__group">
      <h3 class="lab-plugin__title">Preview</h3>
      <div class="lab-plugin__preview">
        <PluginSurface :instance-id="selected.id" :title="selected.title" />
      </div>
    </section>

    <section class="lab-plugin__group">
      <div class="lab-plugin__row">
        <h3 class="lab-plugin__title">Logs ({{ plugins.logs.value.length }})</h3>
        <button type="button" class="button button--small" @click="plugins.clearLogs()">
          Clear
        </button>
      </div>
      <ul class="lab-plugin__logs">
        <li v-for="(entry, index) in plugins.logs.value" :key="index" class="lab-plugin__log">
          <span class="lab-plugin__log-kind lab-plugin__log-kind--{{ entry.kind }}">
            {{ entry.kind }}
          </span>
          <span class="lab-plugin__log-time">{{ formatTime(entry.at) }}</span>
          <span class="lab-plugin__log-message">{{ entry.message }}</span>
        </li>
      </ul>
    </section>

    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">State</h3>
      <pre class="lab-plugin__pre">{{ stateJson || "{}" }}</pre>
      <div class="lab-plugin__row">
        <button type="button" class="button button--small" @click="showHtml = !showHtml">
          {{ showHtml ? "Hide" : "Show" }} rendered HTML ({{ htmlPreview.length }}b)
        </button>
      </div>
      <pre v-if="showHtml" class="lab-plugin__pre">{{ htmlPreview }}</pre>
    </section>

    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">Sources</h3>
      <div class="lab-plugin__row">
        <select v-model="editPlugin" class="lab-plugin__input">
          <option v-for="entry in localEntries" :key="entry.manifest.id" :value="entry.manifest.id">
            {{ entry.manifest.name }}
          </option>
        </select>
        <select v-model="editFile" class="lab-plugin__input">
          <option v-for="file in editFiles" :key="file" :value="file">{{ file }}</option>
        </select>
        <button
          type="button"
          class="button button--primary button--small"
          :disabled="saving || !editFile"
          @click="saveSource"
        >
          Save + reload
        </button>
      </div>

      <textarea v-model="editText" rows="16" class="lab-plugin__editor" spellcheck="false" />
      <p class="lab-plugin__muted">{{ editStatus }}</p>

      <div class="lab-plugin__row">
        <span class="lab-plugin__muted">Make a bundled plugin editable:</span>
        <button
          v-for="entry in plugins.catalog.value.filter(
            (candidate) => candidate.source === 'bundled',
          )"
          :key="entry.manifest.id"
          type="button"
          class="button button--small"
          @click="forkToLocal(entry.manifest.id)"
        >
          {{ entry.manifest.name }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lab-plugin {
  display: grid;
  gap: 1rem;
}

.lab-plugin__group {
  display: grid;
  gap: 0.5rem;
}

.lab-plugin__title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.lab-plugin__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.lab-plugin__action {
  display: grid;
  gap: 0.35rem;
}

.lab-plugin__input,
.lab-plugin__editor {
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.35rem;
}

.lab-plugin__editor {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  resize: vertical;
}

.lab-plugin__preview {
  height: 24rem;
  overflow: hidden;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.lab-plugin__pre {
  max-height: 18rem;
  margin: 0;
  padding: 0.6rem;
  overflow: auto;
  font-size: 0.75rem;
  white-space: pre-wrap;
  background: var(--color-surface-2);
  border-radius: 0.4rem;
}

.lab-plugin__error {
  margin: 0;
  padding: 0.6rem;
  font-size: 0.75rem;
  color: var(--color-danger);
  white-space: pre-wrap;
  background: var(--color-danger-soft);
  border-radius: 0.4rem;
}

.lab-plugin__logs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.2rem;
  max-height: 16rem;
  overflow-y: auto;
}

.lab-plugin__log {
  display: flex;
  gap: 0.5rem;
  font-size: 0.78rem;
}

.lab-plugin__log-kind {
  flex: none;
  width: 3.6rem;
  text-transform: uppercase;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.lab-plugin__log-kind--error {
  color: var(--color-danger);
}

.lab-plugin__log-kind--patch {
  color: var(--color-ok);
}

.lab-plugin__log-time {
  flex: none;
  color: var(--color-text-secondary);
}

.lab-plugin__log-message {
  min-width: 0;
  overflow-wrap: anywhere;
}

.lab-plugin__muted {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
</style>
