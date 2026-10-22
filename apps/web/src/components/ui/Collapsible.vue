<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Trigger text, when no trigger slot is supplied. */
    label?: string;
    /** Accessible name for triggers whose visible text is inside the slot. */
    ariaLabel?: string;
    /** Hide the trailing chevron for a trigger that reads as a plain text control. */
    chevron?: boolean;
    disabled?: boolean;
  }>(),
  { label: undefined, ariaLabel: undefined, chevron: true, disabled: false },
);

const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <CollapsibleRoot v-model:open="open" v-bind="$attrs" :disabled="disabled" class="ui-collapsible">
    <CollapsibleTrigger class="ui-collapsible__trigger" :aria-label="ariaLabel">
      <slot name="trigger">{{ label }}</slot>
      <MsIcon
        v-if="chevron"
        class="ui-collapsible__chevron"
        name="keyboard_arrow_down"
        :size="18"
      />
    </CollapsibleTrigger>

    <CollapsibleContent class="ui-collapsible__content">
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style>
.ui-collapsible {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ui-collapsible__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.ui-collapsible__trigger:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-xs);
}

.ui-collapsible__chevron {
  flex: none;
  color: var(--color-text-secondary);
  transition: transform var(--motion-fast) var(--ease-out);
}

.ui-collapsible__trigger[data-state="open"] .ui-collapsible__chevron {
  transform: rotate(180deg);
}

.ui-collapsible__content {
  min-width: 0;
  overflow: hidden;
}
</style>
