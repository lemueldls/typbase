<script setup lang="ts">
import type { PluginInstance } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

const emit = defineEmits<{ (e: "openPlugin", instanceId: string): void }>();

const plugins = usePlugins();
const { dataRevision } = useWorkspace();
const { t } = useI18n();

const managerOpen = ref(false);

function enabled(instance: PluginInstance): boolean {
  void dataRevision.value;
  return (
    plugins.installs.value.find((install) => install.id === instance.pluginId)?.enabled ?? false
  );
}

const active = computed(() => {
  void dataRevision.value;
  return plugins.instances.value.filter((instance) => enabled(instance));
});

const sidebarInstances = computed(() =>
  active.value.filter((instance) => instance.surface === "sidebar"),
);
const mainInstances = computed(() =>
  active.value.filter((instance) => instance.surface === "main"),
);

function titleOf(instance: PluginInstance): string {
  return plugins.manifestOf(instance.pluginId)?.name ?? instance.title;
}

function iconOf(instance: PluginInstance): MaterialSymbol {
  const icon = instance.icon || plugins.manifestOf(instance.pluginId)?.icon;
  return (icon as MaterialSymbol | undefined) ?? "extension";
}
</script>

<template>
  <div class="plugin-sidebar">
    <div class="plugin-sidebar__header">
      <span>{{ $t("plugins.title") }}</span>
      <UiIconButton
        icon="add"
        :size="20"
        :label="$t('plugins.manage')"
        variant="ghost"
        @click="managerOpen = true"
      />
    </div>

    <div v-for="instance in sidebarInstances" :key="instance.id" class="plugin-sidebar__widget">
      <PluginSurface :instance-id="instance.id" :title="titleOf(instance)" auto-height />
    </div>

    <ul v-if="mainInstances.length" class="plugin-sidebar__list">
      <li v-for="instance in mainInstances" :key="instance.id">
        <button type="button" class="plugin-sidebar__row" @click="emit('openPlugin', instance.id)">
          <MsIcon :name="iconOf(instance)" :size="16" />
          <UiTruncatedText class="plugin-sidebar__label" :text="instance.title" />
        </button>
      </li>
    </ul>

    <UiDialog
      :open="managerOpen"
      :title="$t('plugins.manage')"
      class="plugin-sidebar__dialog"
      @update:open="managerOpen = $event"
    >
      <PluginManager />
    </UiDialog>
  </div>
</template>

<style>
.plugin-sidebar {
  display: grid;
  gap: var(--space-1-5);
}

.plugin-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: var(--space-2);
  font-size: var(--text-md);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.plugin-sidebar__widget {
  margin-bottom: var(--space-1);
}

.plugin-sidebar__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plugin-sidebar__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  font-size: var(--text-md);
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.plugin-sidebar__row:hover {
  background: var(--color-surface-2);
}

.plugin-sidebar__label {
  min-width: 0;
}

.plugin-sidebar__dialog {
  width: min(44rem, 92vw);
  max-height: 82vh;
  overflow-y: auto;
}
</style>
