<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Optional leading glyph. */
    icon?: MaterialSymbol;
    /** Glyph size in px. */
    iconSize?: number;
    /** Styles the item as destructive. */
    danger?: boolean;
  }>(),
  { iconSize: 20, danger: false },
);

const emit = defineEmits<{ (e: "select", event: Event): void }>();
</script>

<template>
  <DropdownMenuItem
    v-bind="$attrs"
    class="menu__item"
    :class="{ menu__danger: danger }"
    @select="emit('select', $event)"
  >
    <MsIcon v-if="icon" :name="icon" :size="iconSize" />
    <slot />
  </DropdownMenuItem>
</template>

<style>
.menu__item .ms-icon {
  flex: none;
}
</style>
