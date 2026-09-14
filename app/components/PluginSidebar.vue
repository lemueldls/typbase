<script setup lang="ts">
import type { PluginInstance } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

/**
 * The sidebar's plugin section: live sidebar widgets plus rows that open
 * main-surface instances in the shell's main pane.
 */
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
      <button
        type="button"
        class="button button--ghost button--icon button--tiny"
        :aria-label="$t('plugins.manage')"
        @click="managerOpen = true"
      >
        <MsIcon name="add" :size="18" />
      </button>
    </div>

    <p v-if="active.length === 0" class="plugin-sidebar__empty">{{ $t("plugins.empty") }}</p>

    <div v-for="instance in sidebarInstances" :key="instance.id" class="plugin-sidebar__widget">
      <PluginSurface :instance-id="instance.id" :title="titleOf(instance)" auto-height />
    </div>

    <ul v-if="mainInstances.length" class="plugin-sidebar__list">
      <li v-for="instance in mainInstances" :key="instance.id">
        <button type="button" class="plugin-sidebar__row" @click="emit('openPlugin', instance.id)">
          <MsIcon :name="iconOf(instance)" :size="16" />
          <span class="plugin-sidebar__label">{{ instance.title }}</span>
        </button>
      </li>
    </ul>

    <DialogRoot :open="managerOpen" @update:open="managerOpen = $event">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog plugin-sidebar__dialog">
          <DialogTitle class="dialog__title">{{ $t("plugins.manage") }}</DialogTitle>
          <PluginManager />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<style scoped>
.plugin-sidebar {
  display: grid;
  gap: 0.35rem;
}

.plugin-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.25rem 0.15rem;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.plugin-sidebar__empty {
  margin: 0;
  padding: 0 0.25rem 0.2rem;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.plugin-sidebar__widget {
  margin-bottom: 0.3rem;
}

.plugin-sidebar__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plugin-sidebar__row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  font-size: 0.9rem;
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.plugin-sidebar__row:hover {
  background: var(--color-surface-2);
}

.plugin-sidebar__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-sidebar__dialog {
  width: min(44rem, 92vw);
  max-height: 82vh;
  overflow-y: auto;
}
</style>
