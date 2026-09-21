<script setup lang="ts">
// Attrs forward to the trigger, so the tooltip can itself be the child of
// another reka trigger (PopoverTrigger/DropdownMenuTrigger `as-child`).
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Tooltip text; an empty string disables the tooltip. */
    text: string;
    side?: "top" | "right" | "bottom" | "left";
    disabled?: boolean;
  }>(),
  { side: "bottom", disabled: false },
);
</script>

<template>
  <TooltipRoot :disabled="disabled || !text">
    <TooltipTrigger as-child v-bind="$attrs">
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="ui-tooltip" :side="side" :side-offset="6">
        {{ text }}
        <TooltipArrow class="ui-tooltip__arrow" :width="10" :height="5" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<style>
.ui-tooltip {
  /* Above every other layer: selects (90), the palette (90/91), toasts (95). */
  z-index: 100;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.14);
}

.ui-tooltip__arrow {
  fill: var(--color-border);
}
</style>
