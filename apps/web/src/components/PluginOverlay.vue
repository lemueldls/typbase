<script setup lang="ts">
/**
 * Floating plugin surfaces (sticky notes and friends). The layer ignores
 * pointer events; each overlay surface opts its own controls back in.
 */
const plugins = usePlugins();
const { dataRevision } = useWorkspace();

const overlays = computed(() => {
  void dataRevision.value;
  return plugins.instances.value.filter((instance) => {
    if (instance.surface !== "overlay") return false;

    return plugins.installs.value.find((install) => install.id === instance.pluginId)?.enabled;
  });
});
</script>

<template>
  <div v-if="overlays.length" class="plugin-overlay">
    <PluginSurface
      v-for="instance in overlays"
      :key="instance.id"
      :instance-id="instance.id"
      :title="instance.title"
      pass-through
    />
  </div>
</template>

<style>
.plugin-overlay {
  position: fixed;
  inset: 0;
  z-index: 45;
  pointer-events: none;
}
</style>
