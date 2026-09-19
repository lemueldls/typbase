<script setup lang="ts">
const model = defineModel<boolean>({ default: false });

withDefaults(
  defineProps<{
    /** Visible label text; the default slot takes precedence. */
    label?: string;
    /** Accessible name when there is no visible label. */
    ariaLabel?: string;
    disabled?: boolean;
  }>(),
  { label: undefined, ariaLabel: undefined, disabled: false },
);
</script>

<template>
  <Label class="ui-switch" :class="{ 'ui-switch--disabled': disabled }">
    <span v-if="label || $slots.default" class="ui-switch__label">
      <slot>{{ label }}</slot>
    </span>
    <SwitchRoot
      :model-value="model"
      class="ui-switch__track"
      :disabled="disabled"
      :aria-label="!label && !$slots.default ? ariaLabel : undefined"
      @update:model-value="(value) => (model = value === true)"
    >
      <SwitchThumb class="ui-switch__thumb" />
    </SwitchRoot>
  </Label>
</template>

<style scoped>
.ui-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-md);
  cursor: pointer;
}

.ui-switch--disabled {
  opacity: 0.55;
  cursor: default;
}

.ui-switch__label {
  flex: 1;
}

.ui-switch__track {
  --switch-pad: calc(0.11rem * var(--ui-size));
  --switch-thumb: calc(0.95rem * var(--ui-size));
  --switch-w: calc(2.2rem * var(--ui-size));

  display: flex;
  align-items: center;
  width: var(--switch-w);
  height: calc(1.25rem * var(--ui-size));
  flex: none;
  padding: var(--switch-pad);
  background: var(--color-surface-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.ui-switch__track[data-state="checked"] {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.ui-switch__track:disabled {
  cursor: default;
}

.ui-switch__thumb {
  display: block;
  width: var(--switch-thumb);
  height: var(--switch-thumb);
  background: var(--color-surface);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  transition: transform 0.15s ease;
}

.ui-switch__track[data-state="checked"] .ui-switch__thumb {
  transform: translateX(calc(var(--switch-w) - var(--switch-thumb) - var(--switch-pad) * 2 - 2px));
}
</style>
