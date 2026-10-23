<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Text keycap. The default slot wins when provided. */
    keys?: string;
  }>(),
  { keys: undefined },
);
</script>

<template>
  <kbd class="ui-kbd">
    <slot>{{ keys }}</slot>
  </kbd>
</template>

<style>
.ui-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.35em;
  padding: 1px var(--space-1);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  box-shadow: 0 1px 0 var(--color-border-strong);
  white-space: nowrap;
}
</style>
