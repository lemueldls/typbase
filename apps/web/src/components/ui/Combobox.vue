<script setup lang="ts">
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    options: Array<{ value: string; label: string; description?: string }>;
    placeholder?: string;
    /** Shown when `options` is empty. */
    empty?: string;
    /** Tooltip text for the trigger; an empty string disables it. */
    label?: string;
    disabled?: boolean;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>(),
  {
    placeholder: "",
    empty: "",
    label: "",
    disabled: false,
    align: "start",
    side: "bottom",
    sideOffset: 4,
  },
);

const open = defineModel<boolean>("open", { default: false });
/** The input text; bind it to filter `options` in the caller. */
const query = defineModel<string>({ default: "" });

// Back closes the combobox before it navigates.
useBackLayer(open);

const emit = defineEmits<{ (e: "select", value: string): void }>();
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :disabled="disabled"
    ignore-filter
    reset-search-term-on-blur
    reset-search-term-on-select
  >
    <!-- ComboboxAnchor stays outside the tooltip: UiTooltip renders its own
         PopperRoot, and a ComboboxAnchor inside it would register with the
         tooltip's popper instead of the combobox's. The anchor wraps the span
         so the tooltip can target the trigger without stealing that ref. -->
    <ComboboxAnchor as-child>
      <span class="combobox__anchor">
        <UiTooltip :text="label" :disabled="!label">
          <ComboboxTrigger as-child>
            <slot name="trigger" />
          </ComboboxTrigger>
        </UiTooltip>
      </span>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        v-bind="$attrs"
        class="combobox"
        position="popper"
        :align="align"
        :side="side"
        :side-offset="sideOffset"
        :body-lock="false"
      >
        <ComboboxInput v-model="query" class="combobox__input" :placeholder="placeholder" />
        <ComboboxViewport class="combobox__viewport">
          <ComboboxItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            class="combobox__item"
            @select.prevent="emit('select', option.value)"
          >
            <slot name="option" :option="option">
              <span class="combobox__item-label">{{ option.label }}</span>
              <span v-if="option.description" class="combobox__item-description">
                {{ option.description }}
              </span>
            </slot>
          </ComboboxItem>
        </ComboboxViewport>
        <ComboboxEmpty class="combobox__empty">{{ empty }}</ComboboxEmpty>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<style>
.combobox__anchor {
  display: inline-flex;
}

.combobox {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 12rem;
  max-width: min(20rem, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - var(--space-8));
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  z-index: 65;
  animation: ui-overlay-fade-in 100ms ease-out;
}

.combobox[data-state="closed"] {
  animation: ui-overlay-fade-out 80ms ease-in;
}

.combobox__input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.combobox__input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}

.combobox__viewport {
  max-height: 260px;
  overflow-y: auto;
}

.combobox__item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-md);
  color: var(--color-text);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}

.combobox__item-label,
.combobox__item-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.combobox__item-description {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.combobox__item[data-highlighted] {
  background: var(--color-surface-2);
}

.combobox__empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
