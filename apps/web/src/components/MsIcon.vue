<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

withDefaults(
  defineProps<{
    name: MaterialSymbol;
    /** Icon size in px; the font is sized, not scaled. */
    size?: number;
    /** Solid fill instead of the outlined style. */
    fill?: boolean;
    /** Variable-font weight, 100-700. */
    weight?: number;
  }>(),
  {
    size: 16,
    fill: false,
    weight: 400,
  },
);
</script>

<template>
  <span
    class="ms-icon material-symbols-rounded"
    :style="{
      'font-size': `${size}px`,
      'font-variation-settings': `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}`,
    }"
    aria-hidden="true"
  >
    {{ name.replaceAll("-", "_") }}
  </span>
</template>

<style scoped>
.ms-icon {
  vertical-align: -0.125em;
  user-select: none;
}
</style>
