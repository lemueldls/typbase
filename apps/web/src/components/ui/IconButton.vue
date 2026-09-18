<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Accessible name, also used as the tooltip text. */
    label: string;
    /** Glyph name; omit to fill the button from the default slot. */
    icon?: MaterialSymbol;
    disabled?: boolean;
    pressed?: boolean;
    /** "plain" is the default bordered button; "ghost" is borderless. */
    variant?: "plain" | "ghost" | "primary";
    /** Colors the button as destructive (red icon and hover tint). */
    danger?: boolean;
    /** Glyph size in px. */
    size?: number;
    tooltipSide?: "top" | "right" | "bottom" | "left";
  }>(),
  { variant: "plain", danger: false, size: 20, tooltipSide: "bottom" },
);
</script>

<template>
  <UiTooltip :text="label" :side="tooltipSide">
    <button
      v-bind="$attrs"
      type="button"
      class="button button--icon"
      :class="{
        'button--ghost': variant === 'ghost',
        'button--primary': variant === 'primary',
        'button--danger-icon': danger,
      }"
      :aria-label="label"
      :aria-pressed="pressed"
      :disabled="disabled"
    >
      <MsIcon v-if="icon" :name="icon" :size="size" />
      <slot v-else />
    </button>
  </UiTooltip>
</template>
