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
