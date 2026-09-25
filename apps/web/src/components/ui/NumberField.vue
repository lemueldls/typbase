<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Accessible name for the input; the step buttons use reka's labels. */
    label: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    size?: "default" | "small";
  }>(),
  { min: undefined, max: undefined, step: 1, disabled: false, size: "default" },
);

const model = defineModel<number | null>({ required: true });
</script>

<template>
  <NumberFieldRoot
    v-model="model"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    class="ui-number"
    :class="{ 'ui-number--small': size === 'small' }"
  >
    <NumberFieldInput class="ui-number__input" :aria-label="label" />
    <div class="ui-number__steps">
      <NumberFieldIncrement class="ui-number__step">
        <MsIcon name="keyboard_arrow_up" :size="14" />
      </NumberFieldIncrement>
      <NumberFieldDecrement class="ui-number__step">
        <MsIcon name="keyboard_arrow_down" :size="14" />
      </NumberFieldDecrement>
    </div>
  </NumberFieldRoot>
</template>

<style>
.ui-number {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  min-width: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.ui-number:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.ui-number__input {
  min-width: 0;
  padding: var(--space-1-5) var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  background: transparent;
  border: none;
  outline: none;
}

.ui-number--small .ui-number__input {
  padding: var(--space-1) var(--space-1-5);
  font-size: var(--text-sm);
}

.ui-number__steps {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
}

.ui-number__step {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
}

.ui-number__step:first-child {
  border-top-right-radius: calc(var(--radius-sm) - 1px);
}

.ui-number__step:last-child {
  border-bottom-right-radius: calc(var(--radius-sm) - 1px);
}

.ui-number__step:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.ui-number__step:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
