<script setup lang="ts">
/**
 * Popover shell: trigger slot, portaled content. Attrs (including `class`)
 * land on the content, so callers style the surface; menu-shaped popovers
 * use `class="menu"`, matching `UiMenu`.
 */
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>(),
  { align: "end", side: "bottom", sideOffset: 4 },
);

/** Optional so popovers that close themselves on select can be driven too. */
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent v-bind="$attrs" :align="align" :side="side" :side-offset="sideOffset">
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
