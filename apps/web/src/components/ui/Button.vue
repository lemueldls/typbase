<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** "plain" is the default bordered button and "ghost" is borderless. */
    variant?: "plain" | "primary" | "danger" | "ghost";
    size?: "default" | "small" | "tiny" | "large";
    /** Optional leading glyph. */
    icon?: MaterialSymbol;
    /** Glyph size in px. Defaults to the size tier's icon step. */
    iconSize?: number;
    /** Submit buttons inside forms. Everything else stays a plain button. */
    type?: "button" | "submit" | "reset";
    /** Render as a different element, e.g. a label wrapping a file input. */
    as?: string | Component;
  }>(),
  { variant: "plain", size: "default", iconSize: undefined, type: "button", as: "button" },
);

const ICON_STEPS = { tiny: 16, small: 18, default: 20, large: 22 } as const;

const iconPx = computed(() => props.iconSize ?? ICON_STEPS[props.size]);
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
      'button--large': size === 'large',
    }"
  >
    <MsIcon v-if="icon" :name="icon" :size="iconPx" />
    <slot />
  </Primitive>
</template>

<style>
.button {
  --button-pad-x: var(--space-3);
  --button-pad-start: var(--button-pad-x);
  --button-icon-inset: var(--space-2);
  --button-gap: var(--space-2);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--button-gap);
  height: var(--control-md);
  padding: 0 var(--button-pad-x) 0 var(--button-pad-start);
  font-size: var(--text-md);
  font-family: inherit;
  white-space: nowrap;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.button:has(> .ms-icon:first-child) {
  --button-pad-start: var(--button-icon-inset);
}

.button:disabled {
  opacity: 0.55;
  cursor: default;
}

.button .ms-icon {
  flex: none;
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

.button--large {
  --button-pad-x: var(--space-4);
  --button-icon-inset: var(--space-2-5);
  --button-gap: var(--space-2);

  height: var(--control-lg);
  border-radius: var(--radius-md);
  /* font-size: var(--text-lg); */
}

.button--icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-md);
  height: var(--control-md);
  padding: 0;
  gap: 0;
  line-height: var(--leading-none);
}

.button--icon-muted {
  color: var(--color-text-secondary);
}

.button--icon[aria-pressed="true"] {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.button--tiny {
  --button-pad-x: var(--space-2);
  --button-icon-inset: var(--space-1-5);
  --button-gap: var(--space-1);

  height: var(--control-xs);
  font-size: var(--text-sm);
}

.button--small {
  --button-pad-x: var(--space-2-5);
  --button-icon-inset: var(--space-2);
  --button-gap: var(--space-1-5);

  height: var(--control-sm);
  font-size: var(--text-sm);
}

.button--large.button--icon {
  width: var(--control-lg);
  height: var(--control-lg);
  padding: 0;
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
    background: var(--color-surface-3);
  }

  .button--icon-muted:hover:not(:disabled) {
    color: var(--color-text);
  }

  .button--danger-icon:hover {
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
  }
}
</style>
