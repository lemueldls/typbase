<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

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
    <div class="plugin-view__toolbar" data-tauri-drag-region="deep">
      <slot name="nav-toggle" />
      <MsIcon :name="icon" :size="18" />
      <UiTruncatedText class="plugin-view__title" :text="title" />
      <div class="plugin-view__actions">
        <UiIconButton icon="close" :label="$t('plugins.close')" @click="emit('close')" />
      </div>
    </div>

    <div class="plugin-view__body">
      <PluginSurface :instance-id="instanceId" :title="title" />
    </div>
  </div>
</template>

<style>
.plugin-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-view__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 3.5rem;
  padding: var(--space-1-5) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.plugin-view__title {
  min-width: 0;
  font-weight: 600;
}

.plugin-view__actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.plugin-view__body {
  flex: 1;
  min-height: 0;
  padding: var(--space-2);
}
</style>
