<script setup lang="ts">
const open = defineModel<string>("open", { default: "" });

useBackLayer(
  computed(() => open.value !== ""),
  () => {
    open.value = "";
  },
);
</script>

<template>
  <MenubarRoot v-model="open" class="menubar">
    <slot />
  </MenubarRoot>
</template>

<style>
.menubar {
  display: flex;
  align-items: center;
  gap: var(--space-0-5);
}
</style>
