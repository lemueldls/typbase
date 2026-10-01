<script setup lang="ts">
// Explicit import, the escape hatch `UiCombobox` uses: the wrapper's own name
// would otherwise shadow the primitive it wraps.
import { MenubarRoot } from "reka-ui";

/**
 * Menu bar shell: the strip of menus across the top of the app. Put
 * `UiMenubarMenu`s in the default slot.
 *
 * The open menu is a value rather than a boolean, because the bar holds several
 * menus and reka's root keeps track of which one is showing.
 */
const open = defineModel<string>("open", { default: "" });

// Back closes the open menu before it navigates.
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
