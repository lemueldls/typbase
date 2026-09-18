<script setup lang="ts">
import type { PluginCapability } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { isFsaSupported } from "@typbase/storage";

/**
 * Install, enable, and shape plugin instances. Shared by the sidebar dialog
 * and the debug lab (the lab renders it inline).
 */
const plugins = usePlugins();
const { t } = useI18n();
const canImportFolder = isFsaSupported();

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

function surfaceForKind(pluginId: string, kind: "sidebar" | "main") {
  return plugins.manifestOf(pluginId)?.surfaces.find((surface) => surface.kind === kind);
}
</script>

<template>
  <div class="plugin-manager">
    <section class="plugin-manager__group">
      <h3 class="plugin-manager__title">{{ $t("plugins.available") }}</h3>

      <div class="plugin-manager__tools">
        <button type="button" class="button button--small" @click="plugins.refreshCatalog()">
          {{ $t("plugins.reload") }}
        </button>
        <button
          v-if="canImportFolder"
          type="button"
          class="button button--small"
          @click="plugins.installFromFolder()"
        >
          {{ $t("plugins.installFolder") }}
        </button>
        <!-- <span class="plugin-manager__hint">{{ $t("plugins.localHint") }}</span> -->
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

          <span class="plugin-manager__actions">
            <button
              v-if="!installOf(entry.manifest.id)"
              type="button"
              class="button button--primary button--small"
              @click="plugins.install(entry.manifest.id)"
            >
              {{ $t("plugins.install") }}
            </button>
            <template v-else>
              <UiSwitch
                :model-value="installOf(entry.manifest.id)?.enabled ?? false"
                :aria-label="entry.manifest.name"
                @update:model-value="(value) => plugins.setEnabled(entry.manifest.id, value)"
              />
              <button
                type="button"
                class="button button--ghost button--small plugin-manager__danger"
                @click="removePlugin(entry.manifest.id, entry.manifest.name)"
              >
                {{ $t("plugins.remove") }}
              </button>
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
            <MsIcon
              :name="instance.surface === 'sidebar' ? 'view_sidebar' : 'open_in_full'"
              :size="16"
            />
            <span>{{ instance.title }}</span>
            <span class="plugin-manager__version">{{ instance.surface }}</span>
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
            <button
              v-for="surface in entry.manifest.surfaces"
              :key="surface.kind"
              type="button"
              class="button button--ghost button--small"
              @click="plugins.createInstance(entry.manifest.id, surface.kind)"
            >
              + {{ $t("plugins.addSurface", { surface: surface.title }) }}
            </button>
          </div>
        </div>
      </article>
    </section>

    <section v-if="plugins.errors.value.length" class="plugin-manager__group">
      <header class="plugin-manager__entry-head">
        <h3 class="plugin-manager__title">{{ $t("plugins.problems") }}</h3>
        <button
          type="button"
          class="button button--ghost button--small"
          @click="plugins.clearErrors()"
        >
          {{ $t("plugins.clear") }}
        </button>
      </header>
      <ul class="plugin-manager__errors">
        <li
          v-for="(error, index) in plugins.errors.value"
          :key="index"
          class="plugin-manager__error"
        >
          <span>{{ error.message }}</span>
          <span class="plugin-manager__version">{{
            error.pluginId ?? error.instanceId ?? ""
          }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.plugin-manager {
  display: grid;
  gap: 1rem;
}

.plugin-manager__group {
  display: grid;
  gap: 0.5rem;
}

.plugin-manager__title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.plugin-manager__empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.plugin-manager__tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.plugin-manager__hint {
  flex: 1 1 12rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.plugin-manager__entry {
  display: grid;
  gap: 0.4rem;
  padding: 0.65rem 0.75rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.plugin-manager__entry-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.plugin-manager__name {
  font-weight: 650;
}

.plugin-manager__version {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.plugin-manager__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-left: auto;
}

.plugin-manager__danger {
  color: var(--color-danger);
}

.plugin-manager__description {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.plugin-manager__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.plugin-manager__chip {
  padding: 0.05rem 0.45rem;
  font-size: 0.72rem;
  background: var(--color-surface-3);
  border-radius: 999px;
}

.plugin-manager__instances {
  display: grid;
  gap: 0.25rem;
}

.plugin-manager__instance {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.plugin-manager__add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.plugin-manager__errors {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.3rem;
}

.plugin-manager__error {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  font-size: 0.8rem;
  background: var(--color-danger-soft);
  border-radius: 0.4rem;
}
</style>
