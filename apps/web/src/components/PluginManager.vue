<script setup lang="ts">
import type { PluginCapability, PluginInstance } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { isFsaSupported } from "@typbase/storage";

/**
 * Install, enable, and shape plugin instances. Shared by the sidebar dialog
 * and the debug lab (the lab renders it inline). Compile problems live in the
 * studio; this list only shows a per-plugin issue count.
 */
const emit = defineEmits<{ (e: "openInstance", instanceId: string): void }>();

const plugins = usePlugins();
const router = useRouter();
const { t } = useI18n();
const canImportFolder = isFsaSupported();

const renameOpen = ref(false);
const renameTarget = ref<PluginInstance>();
const renameTitle = ref("");

function startRename(instance: PluginInstance): void {
  renameTarget.value = instance;
  renameTitle.value = instance.title;
  renameOpen.value = true;
}

async function confirmRename(): Promise<void> {
  const target = renameTarget.value;
  renameOpen.value = false;
  renameTarget.value = undefined;
  if (target) await plugins.renameInstance(target.id, renameTitle.value);
}

const CAPABILITY_LABELS: Record<PluginCapability, string> = {
  "pages.read": "plugins.capPagesRead",
  "pages.create": "plugins.capPagesCreate",
  "pages.write": "plugins.capPagesWrite",
  "daily.write": "plugins.capDailyWrite",
  "plugin.data": "plugins.capData",
  "plugin.ai": "plugins.capAi",
  "ui.external": "plugins.capExternal",
};

function installOf(pluginId: string) {
  return plugins.installs.value.find((install) => install.id === pluginId);
}

function instancesOf(pluginId: string) {
  return plugins.instances.value.filter((instance) => instance.pluginId === pluginId);
}

async function removePlugin(pluginId: string, name: string) {
  if (!window.confirm(t("plugins.confirmRemove", { name }))) return;
  await plugins.uninstall(pluginId);
}

function develop(pluginId: string) {
  void router.push({ path: "/plugins", query: { plugin: pluginId } });
}

function openInstance(instance: PluginInstance) {
  emit("openInstance", instance.id);
}
</script>

<template>
  <div class="plugin-manager">
    <section class="plugin-manager__group">
      <h3 class="plugin-manager__title">{{ $t("plugins.available") }}</h3>

      <div class="plugin-manager__tools">
        <UiButton size="small" @click="plugins.refreshCatalog()">
          {{ $t("plugins.reload") }}
        </UiButton>
        <UiButton size="small" v-if="canImportFolder" @click="plugins.installFromFolder()">
          {{ $t("plugins.installFolder") }}
        </UiButton>
      </div>

      <p v-if="plugins.catalog.value.length === 0" class="plugin-manager__empty">
        {{ $t("plugins.noCatalog") }}
      </p>

      <article
        v-for="entry in plugins.catalog.value"
        :key="entry.manifest.id"
        class="plugin-manager__entry"
      >
        <header class="plugin-manager__entry-head">
          <MsIcon
            :name="(entry.manifest.icon as MaterialSymbol | undefined) ?? 'extension'"
            :size="20"
          />
          <span class="plugin-manager__name">{{ entry.manifest.name }}</span>
          <span class="plugin-manager__version">v{{ entry.manifest.version }}</span>
          <span v-if="entry.source === 'local'" class="plugin-manager__version">
            {{ $t("plugins.sourceLocal") }}
          </span>
          <span v-if="plugins.errorsFor(entry.manifest.id).length" class="plugin-manager__issues">
            {{ $t("plugins.issues") }}
          </span>

          <span class="plugin-manager__actions">
            <UiButton
              v-if="!installOf(entry.manifest.id)"
              variant="primary"
              size="small"
              @click="plugins.install(entry.manifest.id)"
            >
              {{ $t("plugins.install") }}
            </UiButton>
            <template v-else>
              <UiSwitch
                :model-value="installOf(entry.manifest.id)?.enabled ?? false"
                :aria-label="entry.manifest.name"
                @update:model-value="(value) => plugins.setEnabled(entry.manifest.id, value)"
              />
              <UiButton variant="ghost" size="small" @click="develop(entry.manifest.id)">
                {{ $t("plugins.develop") }}
              </UiButton>
              <UiButton
                variant="ghost"
                size="small"
                class="plugin-manager__danger"
                @click="removePlugin(entry.manifest.id, entry.manifest.name)"
              >
                {{ $t("plugins.remove") }}
              </UiButton>
            </template>
          </span>
        </header>

        <p v-if="entry.manifest.description" class="plugin-manager__description">
          {{ entry.manifest.description }}
        </p>

        <div v-if="entry.manifest.capabilities.length" class="plugin-manager__chips">
          <span
            v-for="capability in entry.manifest.capabilities"
            :key="capability"
            class="plugin-manager__chip"
          >
            {{ $t(CAPABILITY_LABELS[capability]) }}
          </span>
        </div>

        <div v-if="installOf(entry.manifest.id)" class="plugin-manager__instances">
          <div
            v-for="instance in instancesOf(entry.manifest.id)"
            :key="instance.id"
            class="plugin-manager__instance"
          >
            <MsIcon :name="'extension'" :size="16" />
            <span>{{ instance.title }}</span>
            <span class="plugin-manager__version">
              {{
                plugins
                  .surfacesOf(instance.id)
                  .map((surface) => surface.kind)
                  .join(", ")
              }}
            </span>
            <UiButton
              v-if="
                plugins.surfaceOf(instance.id, 'pane') || plugins.surfaceOf(instance.id, 'window')
              "
              variant="ghost"
              size="small"
              class="button--tiny"
              @click="openInstance(instance)"
            >
              {{ $t("plugins.open") }}
            </UiButton>
            <UiIconButton
              icon="edit"
              :size="16"
              :label="$t('plugins.renameInstance')"
              variant="ghost"
              class="button--tiny"
              @click="startRename(instance)"
            />
            <UiIconButton
              icon="delete"
              :size="16"
              :label="$t('plugins.removeInstance')"
              variant="ghost"
              class="button--tiny"
              @click="plugins.removeInstance(instance.id)"
            />
          </div>

          <div class="plugin-manager__add">
            <UiButton variant="ghost" size="small" @click="plugins.addInstance(entry.manifest.id)">
              + {{ $t("plugins.addInstance") }}
            </UiButton>
          </div>
        </div>
      </article>
    </section>

    <UiDialog
      :open="renameOpen"
      :title="$t('plugins.renameInstance')"
      layer="top"
      @update:open="renameOpen = $event"
    >
      <div class="plugin-manager__rename">
        <UiTextField v-model="renameTitle" :label="$t('plugins.instanceName')" />
        <div class="plugin-manager__rename-actions">
          <UiButton
            variant="primary"
            size="small"
            :disabled="!renameTitle.trim()"
            @click="confirmRename"
          >
            {{ $t("common.save") }}
          </UiButton>
          <UiButton size="small" @click="renameOpen = false">{{ $t("common.cancel") }}</UiButton>
        </div>
      </div>
    </UiDialog>
  </div>
</template>

<style>
.plugin-manager {
  display: grid;
  gap: var(--space-4);
}

.plugin-manager__group {
  display: grid;
  gap: var(--space-2);
}

.plugin-manager__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.plugin-manager__empty {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.plugin-manager__tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}

.plugin-manager__entry {
  display: grid;
  gap: var(--space-1-5);
  padding: var(--space-2-5) var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.plugin-manager__entry-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.plugin-manager__name {
  font-weight: 650;
}

.plugin-manager__version {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.plugin-manager__issues {
  padding: 0 var(--space-1-5);
  font-size: var(--text-2xs);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-full);
}

.plugin-manager__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.plugin-manager__danger {
  color: var(--color-danger);
}

.plugin-manager__description {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.plugin-manager__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.plugin-manager__chip {
  padding: var(--space-0-5) var(--space-2);
  font-size: var(--text-xs);
  background: var(--color-surface-3);
  border-radius: var(--radius-full);
}

.plugin-manager__instances {
  display: grid;
  gap: var(--space-1);
}

.plugin-manager__instance {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  font-size: var(--text-md);
}

.plugin-manager__add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}

.plugin-manager__rename {
  display: grid;
  gap: var(--space-3);
}

.plugin-manager__rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1-5);
}
</style>
