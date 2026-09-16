<script setup lang="ts">
/**
 * Dropdown menu shell: trigger slot, portaled content styled as a menu.
 * Put `UiMenuItem`s (and `UiMenuSeparator`s) in the default slot.
 */
withDefaults(
  defineProps<{
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>(),
  { align: "end", side: "bottom", sideOffset: 4 },
);
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="menu" :align="align" :side="side" :side-offset="sideOffset">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
