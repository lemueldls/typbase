<script lang="ts">
/** One choice in a `UiSelect`. The value type is inferred from the options. */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}
</script>

<script setup lang="ts" generic="T extends string">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    options: SelectOption<T>[];
    /** Accessible name; the trigger has no visible label. */
    label: string;
    /** Shown when no value is selected. */
    placeholder?: string;
    disabled?: boolean;
    size?: "default" | "small";
  }>(),
  { placeholder: undefined, disabled: false, size: "default" },
);

const model = defineModel<T>({ required: true });
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger
      v-bind="$attrs"
      class="ui-select__trigger"
      :class="{ 'ui-select__trigger--small': size === 'small' }"
      :aria-label="label"
    >
      <SelectValue :placeholder="placeholder" />
      <SelectIcon class="ui-select__icon">
        <MsIcon name="keyboard_arrow_down" :size="16" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent class="ui-select__content" position="popper" :side-offset="4">
        <SelectViewport class="ui-select__viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
            class="ui-select__item"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="ui-select__indicator">
              <MsIcon name="check" :size="14" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.ui-select__content {
  z-index: 90;
  min-width: var(--reka-select-trigger-width);
  max-height: calc(100dvh - var(--space-8));
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
}

.ui-select__viewport {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.ui-select__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  font-size: var(--text-md);
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
}

.ui-select__item[data-highlighted] {
  background: var(--color-accent-soft);
}

.ui-select__item[data-disabled] {
  opacity: 0.5;
  cursor: default;
}

.ui-select__indicator {
  display: inline-flex;
  color: var(--color-accent);
}

.ui-select__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1-5);
  min-width: 0;
  padding: var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.ui-select__trigger:hover {
  background: var(--color-surface-2);
}

.ui-select__trigger:disabled {
  opacity: 0.55;
  cursor: default;
}

.ui-select__trigger--small {
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-1-5);
  font-size: var(--text-sm);
}

.ui-select__icon {
  display: inline-flex;
  color: var(--color-text-secondary);
}
</style>
