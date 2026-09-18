<script setup lang="ts">
/**
 * Checkbox with an integrated label. The root is reka's `Label` (a `<label>`
 * element), so clicking the text toggles the box; the label prop can be
 * replaced by the default slot.
 */
const model = defineModel<boolean>({ default: false });

withDefaults(
  defineProps<{
    /** Visible label text; the default slot takes precedence. */
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
      <CheckboxIndicator class="ui-checkbox__indicator">
        <MsIcon name="check" :size="14" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="label || $slots.default" class="ui-checkbox__label">
      <slot>{{ label }}</slot>
    </span>
  </Label>
</template>

<style scoped>
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.ui-checkbox--disabled {
  opacity: 0.55;
  cursor: default;
}

.ui-checkbox__box {
  display: grid;
  place-content: center;
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  padding: 0;
  color: var(--color-surface);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.25rem;
  cursor: pointer;
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
</style>
