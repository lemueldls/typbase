<script setup lang="ts">
import type { PluginInstance } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

const emit = defineEmits<{ (e: "openPlugin", instanceId: string): void }>();

const plugins = usePlugins();
const { t } = useI18n();

const managerOpen = ref(false);

const widgets = computed(() => plugins.instancesWithSurface("widget"));
/** Instances that open in a pane or a floating window get a sidebar row. */
const rows = computed(() => [
  ...plugins.instancesWithSurface("pane"),
  ...plugins.instancesWithSurface("window"),
]);

function titleOf(instance: PluginInstance): string {
  return plugins.manifestOf(instance.pluginId)?.name ?? instance.title;
}

function iconOf(instance: PluginInstance): MaterialSymbol {
  const icon = instance.icon || plugins.manifestOf(instance.pluginId)?.icon;
  return (icon as MaterialSymbol | undefined) ?? "extension";
}

function hasProblems(instance: PluginInstance): boolean {
  return plugins.errorsFor(instance.pluginId).length > 0;
}

function openRow(instance: PluginInstance): void {
  if (plugins.surfaceOf(instance.id, "pane")) emit("openPlugin", instance.id);
  else plugins.openWindow(instance.id);
}

function openInstanceById(instanceId: string): void {
  const instance = plugins.instanceById(instanceId);
  if (instance) openRow(instance);
}
</script>

<template>
  <div class="plugin-sidebar">
    <div class="plugin-sidebar__header">
      <span>{{ $t("plugins.title") }}</span>
      <UiIconButton
        icon="widgets"
        :size="20"
        :label="$t('plugins.manage')"
        variant="ghost"
        @click="managerOpen = true"
      />
    </div>

    <div v-for="instance in widgets" :key="instance.id" class="plugin-sidebar__widget">
      <PluginSurface
        :instance-id="instance.id"
        surface="widget"
        :title="titleOf(instance)"
        auto-height
      />
    </div>

    <ul v-if="rows.length" class="plugin-sidebar__list">
      <li v-for="instance in rows" :key="instance.id">
        <button type="button" class="plugin-sidebar__row" @click="openRow(instance)">
          <MsIcon :name="iconOf(instance)" :size="16" />
          <UiTruncatedText class="plugin-sidebar__label" :text="instance.title" />
          <span
            v-if="hasProblems(instance)"
            class="plugin-sidebar__problem"
            :title="t('plugins.issues')"
          />
        </button>
      </li>
    </ul>

    <UiDialog
      :open="managerOpen"
      :title="$t('plugins.manage')"
      class="plugin-sidebar__dialog"
      @update:open="managerOpen = $event"
    >
      <PluginManager @open-instance="openInstanceById" />
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
  flex: 1;
  min-width: 0;
}

.plugin-sidebar__problem {
  flex: none;
  width: 6px;
  height: 6px;
  background: var(--color-danger);
  border-radius: var(--radius-full);
}

.plugin-sidebar__dialog {
  width: min(44rem, 92vw);
  max-height: 82vh;
  overflow-y: auto;
}
</style>
