<script setup lang="ts">
import { computed, useAttrs, useTemplateRef } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Accessible name; use a wrapping label when there is one. */
    label?: string;
    disabled?: boolean;
    size?: "small" | "default" | "large";
  }>(),
  { modelValue: undefined, label: undefined, disabled: false, size: "default" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const attrs = useAttrs();
const input = useTemplateRef<HTMLInputElement>("input");

// class/style size the field (the root); everything else is input semantics.
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;

  return rest;
});

/** Controlled with v-model, uncontrolled with `:value` + `@change`. */
const value = computed(() => props.modelValue ?? (attrs.value as string | undefined) ?? undefined);

/** The `label` prop or a passed-through `aria-label`. */
const ariaLabel = computed(() => props.label ?? (attrs["aria-label"] as string | undefined));

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

defineExpose({ input, focus: () => input.value?.focus() });
</script>

<template>
  <span
    class="ui-text-field"
    :class="[`ui-text-field--${size}`, { 'ui-text-field--disabled': disabled }, attrs.class]"
    :style="attrs.style"
  >
    <slot name="leading" />
    <input
      ref="input"
      v-bind="inputAttrs"
      :value="value"
      :disabled="disabled"
      class="ui-text-field__input"
      :aria-label="ariaLabel"
      @input="onInput"
    />
    <slot name="trailing" />
  </span>
</template>

<style scoped>
.ui-text-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  width: 100%;
  min-width: 0;
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.ui-text-field:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.ui-text-field--disabled {
  opacity: 0.55;
}

.ui-text-field--small {
  padding: var(--space-1) var(--space-1-5);
  font-size: var(--text-sm);
}

.ui-text-field--default {
  padding: var(--space-1-5) var(--space-2);
}

.ui-text-field--large {
  padding: var(--space-2-5) var(--space-3);
  font-size: var(--text-lg);
  border-radius: var(--radius-md);
}

.ui-text-field__input {
  flex: 1;
  min-width: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
}

.ui-text-field__input::placeholder {
  color: var(--color-text-secondary);
}
</style>
