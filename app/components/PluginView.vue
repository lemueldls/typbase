<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

/**
 * A plugin's main surface. The shell swaps PageView for this when an
 * instance is open; the frame fills the pane.
 */
const props = defineProps<{ instanceId: string }>();

const emit = defineEmits<{ (e: "close"): void }>();

const plugins = usePlugins();
const { dataRevision } = useWorkspace();

const instance = computed(() => {
  void dataRevision.value;
  return plugins.instances.value.find((candidate) => candidate.id === props.instanceId);
});

const title = computed(() => {
  if (!instance.value) return "";
  return plugins.manifestOf(instance.value.pluginId)?.name ?? instance.value.title;
});

const icon = computed<MaterialSymbol>(() => {
  const value = instance.value?.icon || plugins.manifestOf(instance.value?.pluginId ?? "")?.icon;
  return (value as MaterialSymbol | undefined) ?? "extension";
});
</script>

<template>
  <div class="plugin-view">
    <div class="plugin-view__toolbar">
      <slot name="nav-toggle" />
      <MsIcon :name="icon" :size="18" />
      <span class="plugin-view__title">{{ title }}</span>
      <div class="plugin-view__actions">
        <button
          type="button"
          class="button button--icon"
          :aria-label="$t('plugins.close')"
          @click="emit('close')"
        >
          <MsIcon name="close" :size="20" />
        </button>
      </div>
    </div>

    <div class="plugin-view__body">
      <PluginSurface :instance-id="instanceId" :title="title" />
    </div>
  </div>
</template>

<style scoped>
.plugin-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-view__toolbar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 3.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.plugin-view__title {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-view__actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.plugin-view__body {
  flex: 1;
  min-height: 0;
  padding: 0.5rem;
}
</style>
