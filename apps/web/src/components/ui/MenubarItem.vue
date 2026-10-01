<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import { MenubarItem } from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Optional leading glyph. */
    icon?: MaterialSymbol;
    /** Glyph size in px. */
    iconSize?: number;
    /** Styles the item as destructive. */
    danger?: boolean;
    disabled?: boolean;
  }>(),
  { iconSize: 20, danger: false, disabled: false },
);

const emit = defineEmits<{ (e: "select", event: Event): void }>();
</script>

<template>
  <MenubarItem
    v-bind="$attrs"
    class="menu__item"
    :class="{ menu__danger: danger }"
    :disabled="disabled"
    @select="emit('select', $event)"
  >
    <MsIcon v-if="icon" :name="icon" :size="iconSize" />
    <slot />
  </MenubarItem>
</template>
