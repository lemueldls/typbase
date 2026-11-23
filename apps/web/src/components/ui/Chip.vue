<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Render as a different element, e.g. a button trigger. */
    as?: string | Component;
    /** Small uses the 2xs text step, default uses xs. */
    size?: "small" | "default";
    /** Submit buttons inside forms. Everything else stays a plain button. */
    type?: "button" | "submit" | "reset";
    /** Adds a trailing remove button. */
    removable?: boolean;
    /** Accessible name for the remove button. */
    removeLabel?: string;
  }>(),
  {
    as: "span",
    size: "default",
    type: "button",
    removable: false,
    removeLabel: undefined,
  },
);

const emit = defineEmits<{ (e: "remove"): void }>();
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="as"
    :type="as === 'button' ? type : undefined"
    class="ui-chip"
    :class="{
      'ui-chip--small': size === 'small',
      'ui-chip--interactive': as !== 'span',
    }"
  >
    <slot name="leading" />
    <span v-if="$slots.default" class="ui-chip__text"><slot /></span>
    <slot name="trailing" />
    <button
      v-if="removable"
      type="button"
      class="ui-chip__remove"
      :aria-label="removeLabel"
      @click.stop="emit('remove')"
    >
      <MsIcon name="close" :size="12" />
    </button>
  </Primitive>
</template>

<style>
.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: var(--space-0-5) var(--space-2);
  font: inherit;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
  text-decoration: none;
  white-space: nowrap;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.ui-chip--small {
  padding: 0 var(--space-1-5);
  font-size: var(--text-2xs);
}

.ui-chip--interactive {
  cursor: pointer;
}

.ui-chip--interactive:hover,
.ui-chip--interactive:focus-visible {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.ui-chip--interactive:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.ui-chip__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-chip__remove {
  display: inline-grid;
  flex: none;
  place-content: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.ui-chip__remove:hover,
.ui-chip__remove:focus-visible {
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
  outline: none;
}
</style>
