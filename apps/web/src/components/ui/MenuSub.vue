<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

/**
 * Submenu shell: a labeled trigger row and portaled content styled as a menu.
 * Put `UiMenuItem`s in the default slot.
 */
withDefaults(
  defineProps<{
    label: string;
    /** Optional leading glyph for the trigger row. */
    icon?: MaterialSymbol;
    sideOffset?: number;
    disabled?: boolean;
  }>(),
  { icon: undefined, sideOffset: 2, disabled: false },
);
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger class="menu__item menu__sub-trigger" :disabled="disabled">
      <MsIcon v-if="icon" :name="icon" :size="20" />
      <span class="menu__sub-label">{{ label }}</span>
      <MsIcon name="chevron_right" :size="20" class="menu__sub-chevron" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent class="menu" :side-offset="sideOffset">
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>

<style>
.menu__sub-label {
  flex: 1;
  min-width: 0;
}

.menu__sub-chevron {
  flex: none;
  color: var(--color-text-secondary);
}

.menu .menu__sub-trigger[data-state="open"] {
  background: var(--color-accent-soft);
}
</style>
