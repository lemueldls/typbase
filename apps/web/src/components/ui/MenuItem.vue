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
    /**
     * Check-list item. `true` shows the check, `false` reserves its slot so a
     * list of choices stays aligned; leave unset for a plain item.
     */
    checked?: boolean;
  }>(),
  { iconSize: 20, danger: false, checked: undefined },
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
    <template v-if="checked !== undefined">
      <MsIcon v-if="checked" name="check" :size="iconSize" />
      <MsIcon v-else name="check" :size="iconSize" class="menu__check-hidden" aria-hidden="true" />
    </template>
    <MsIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <slot />
  </DropdownMenuItem>
</template>

<style>
.menu__item .ms-icon {
  flex: none;
}

.menu__check-hidden {
  visibility: hidden;
}
</style>
