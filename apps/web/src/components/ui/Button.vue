<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** "plain" is the default bordered button; "ghost" is borderless. */
    variant?: "plain" | "primary" | "danger" | "ghost";
    size?: "default" | "small" | "tiny";
    /** Submit buttons inside forms; everything else stays a plain button. */
    type?: "button" | "submit" | "reset";
    /** Render as a different element, e.g. a label wrapping a file input. */
    as?: string | Component;
  }>(),
  { variant: "plain", size: "default", type: "button", as: "button" },
);
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="as"
    :type="as === 'button' ? type : undefined"
    class="button"
    :class="{
      'button--primary': variant === 'primary',
      'button--danger': variant === 'danger',
      'button--ghost': variant === 'ghost',
      'button--small': size === 'small',
      'button--tiny': size === 'tiny',
    }"
  >
    <slot />
  </Primitive>
</template>

<style>
.button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-2);
  font-size: var(--text-md);
  font-family: inherit;
  white-space: nowrap;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.button:disabled {
  opacity: 0.55;
  cursor: default;
}

.button--primary {
  color: var(--color-surface);
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.button--danger {
  color: var(--color-surface);
  background: var(--color-danger);
  border-color: var(--color-danger);
}

.button--ghost {
  background: transparent;
  border-color: transparent;
}

.button--icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-md);
  height: var(--control-md);
  padding: 0;
  line-height: var(--leading-none);
}

.button .ms-icon {
  flex: none;
}

.button--tiny {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
}

.button--small {
  padding: var(--space-1-5) var(--space-3);
  font-size: var(--text-sm);
}

.button--small.button--icon {
  width: var(--control-sm);
  height: var(--control-sm);
  padding: 0;
}

.button--tiny.button--icon {
  width: var(--control-xs);
  height: var(--control-xs);
  padding: 0;
}

.button--danger-icon {
  color: var(--color-danger);
}

@media (hover: hover) {
  .button:hover {
    background: var(--color-surface-2);
  }

  .button--primary:hover {
    background: color-mix(in srgb, var(--color-accent) 84%, var(--color-text));
  }

  .button--danger:hover {
    background: color-mix(in srgb, var(--color-danger) 84%, var(--color-text));
  }

  .button--ghost:hover {
    background: var(--color-surface-2);
  }

  .button--danger-icon:hover {
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
  }
}
</style>
