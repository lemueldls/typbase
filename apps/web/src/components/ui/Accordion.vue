<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Allow closing the open item by clicking it again. */
    collapsible?: boolean;
    disabled?: boolean;
  }>(),
  { collapsible: true, disabled: false },
);

/** Value of the open item, or undefined when every item is closed. */
const open = defineModel<string>();
</script>

<template>
  <AccordionRoot
    v-model="open"
    type="single"
    :collapsible="collapsible"
    :disabled="disabled"
    class="ui-accordion"
  >
    <slot />
  </AccordionRoot>
</template>

<style>
.ui-accordion {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ui-accordion__item {
  min-width: 0;
}

.ui-accordion__header {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  margin: 0;
  font: inherit;
}

.ui-accordion__trigger {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.ui-accordion__trigger:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-xs);
}

.ui-accordion__chevron {
  flex: none;
  color: var(--color-text-secondary);
  transition: transform var(--motion-fast) var(--ease-out);
}

.ui-accordion__trigger[data-state="open"] .ui-accordion__chevron {
  transform: rotate(90deg);
}

.ui-accordion__actions {
  display: flex;
  flex: none;
  gap: var(--space-0-5);
}

.ui-accordion__content {
  min-width: 0;
  overflow: hidden;
}
</style>
