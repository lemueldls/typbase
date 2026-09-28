<script setup lang="ts">
/**
 * Checkbox with an integrated label. The root is reka's `Label` (a `<label>`
 * element), so clicking the text toggles the box. The label prop can be
 * replaced by the default slot.
 */
const model = defineModel<boolean>({ default: false });

withDefaults(
  defineProps<{
    /** Visible label text, though the default slot takes precedence. */
    label?: string;
    disabled?: boolean;
  }>(),
  { label: undefined, disabled: false },
);
</script>

<template>
  <Label class="ui-checkbox" :class="{ 'ui-checkbox--disabled': disabled }">
    <CheckboxRoot
      :model-value="model"
      class="ui-checkbox__box"
      :disabled="disabled"
      @update:model-value="(value) => (model = value === true)"
    >
      <CheckboxIndicator class="ui-checkbox__indicator" force-mount>
        <MsIcon class="ui-checkbox__mark ui-checkbox__mark--check" name="check" :size="20" />
        <MsIcon class="ui-checkbox__mark ui-checkbox__mark--dash" name="remove" :size="20" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="label || $slots.default" class="ui-checkbox__label">
      <slot>{{ label }}</slot>
    </span>
  </Label>
</template>

<style>
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-md);
  cursor: pointer;
}

.ui-checkbox--disabled {
  opacity: 0.55;
  cursor: default;
}

.ui-checkbox__box {
  display: grid;
  place-content: center;
  width: calc(1.15rem * var(--ui-size));
  height: calc(1.15rem * var(--ui-size));
  flex: none;
  padding: 0;
  color: var(--color-surface);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast),
    transform var(--motion-spring);
}

.ui-checkbox__box:hover:not(:disabled) {
  border-color: var(--color-accent);
}

/* Pressed: the box gives under the finger, then springs back. */
.ui-checkbox__box:active:not(:disabled) {
  transform: scale(0.9);
}

.ui-checkbox__box[data-state="checked"],
.ui-checkbox__box[data-state="indeterminate"] {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.ui-checkbox__box:disabled {
  cursor: default;
}

.ui-checkbox__indicator {
  display: grid;
  place-content: center;
}

/* The mark pops in with a small overshoot, and indeterminate swaps the check
   for a dash. Both stay mounted so unchecking animates out too. */
.ui-checkbox__mark {
  grid-area: 1 / 1;
  opacity: 0;
  transform: scale(0.3);
  transition:
    opacity var(--motion-fast),
    transform var(--motion-spring);
}

.ui-checkbox__box[data-state="checked"] .ui-checkbox__mark--check,
.ui-checkbox__box[data-state="indeterminate"] .ui-checkbox__mark--dash {
  opacity: 1;
  transform: scale(1);
}
</style>
