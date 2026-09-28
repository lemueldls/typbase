<script setup lang="ts">
const model = defineModel<boolean>({ default: false });

withDefaults(
  defineProps<{
    /** Visible label text, though the default slot takes precedence. */
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
      <SwitchThumb class="ui-switch__thumb">
        <MsIcon class="ui-switch__check" name="check" :size="14" :weight="600" />
      </SwitchThumb>
    </SwitchRoot>
  </Label>
</template>

<style>
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
  /* Track, thumb, and padding all follow the control scale. The switch is a
     compound widget, so its proportions stay here instead of in tokens. */
  --switch-h: var(--control-xs);
  --switch-thumb: calc(var(--switch-h) * 0.78);
  --switch-w: calc(var(--switch-h) * 1.75);
  --switch-pad: calc((var(--switch-h) - var(--switch-thumb) - 2px) / 2);
  /* How far the thumb travels between the two ends. */
  --switch-travel: calc(var(--switch-w) - var(--switch-thumb) - var(--switch-pad) * 2 - 2px);

  display: flex;
  align-items: center;
  width: var(--switch-w);
  height: var(--switch-h);
  flex: none;
  padding: var(--switch-pad);
  background: var(--color-surface-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition:
    background var(--motion-base),
    border-color var(--motion-base);
}

.ui-switch__track:hover:not(:disabled) {
  border-color: var(--color-accent);
}

.ui-switch__track[data-state="checked"] {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.ui-switch__track:disabled {
  cursor: default;
}

.ui-switch__thumb {
  display: grid;
  place-items: center;
  width: var(--switch-thumb);
  height: var(--switch-thumb);
  background: var(--color-surface);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  transform-origin: left center;
  /* The spring easing overshoots a hair and settles. */
  transition: transform var(--motion-spring);
}

.ui-switch__track[data-state="checked"] .ui-switch__thumb {
  transform: translateX(var(--switch-travel));
  transform-origin: right center;
}

/* Pressed: the thumb stretches toward the end it is heading for, the way a
   physical toggle gives under a finger. */
.ui-switch__track:active .ui-switch__thumb {
  transform: translateX(0) scaleX(1.18);
}

.ui-switch__track[data-state="checked"]:active .ui-switch__thumb {
  transform: translateX(var(--switch-travel)) scaleX(1.18);
}

.ui-switch__check {
  color: var(--color-accent);
  opacity: 0;
  transform: scale(0.3);
  transition:
    opacity var(--motion-fast),
    transform var(--motion-spring);
}

.ui-switch__track[data-state="checked"] .ui-switch__check {
  opacity: 1;
  transform: scale(1);
}
</style>
