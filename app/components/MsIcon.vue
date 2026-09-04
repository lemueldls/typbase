<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

/**
 * Material Symbols icon. Material Symbols is a ligature font: the glyph name
 * rendered as text (e.g. "settings") becomes the icon, so this component is
 * just a styled span. The same font powers the CodeMirror completion icons
 * through CSS ::after content (see css/codemirror.css).
 */
const props = withDefaults(
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
      'font-size': `${props.size}px`,
      'font-variation-settings': `'FILL' ${props.fill ? 1 : 0}, 'wght' ${props.weight}`,
    }"
    aria-hidden="true"
  >
    {{ props.name.replaceAll("-", "_") }}
  </span>
</template>

<style scoped>
.ms-icon {
  vertical-align: -0.125em;
  user-select: none;
}
</style>
