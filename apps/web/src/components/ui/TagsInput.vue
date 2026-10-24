<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** Accessible name for the input. */
    label: string;
    placeholder?: string;
    disabled?: boolean;
    /** Maximum number of tags. Zero means no limit. */
    max?: number;
  }>(),
  { placeholder: undefined, disabled: false, max: 0 },
);

const tags = defineModel<string[]>({ default: () => [] });
</script>

<template>
  <TagsInputRoot
    v-model="tags"
    v-bind="$attrs"
    class="ui-tags-input"
    :add-on-paste="true"
    :add-on-blur="true"
    :add-on-tab="true"
    :duplicate="false"
    :disabled="disabled"
    :max="max"
  >
    <TagsInputItem v-for="tag in tags" :key="tag" :value="tag" class="ui-tags-input__item">
      <TagsInputItemText class="ui-tags-input__text" />
      <TagsInputItemDelete class="ui-tags-input__delete">
        <MsIcon name="close" :size="14" />
      </TagsInputItemDelete>
    </TagsInputItem>

    <TagsInputInput class="ui-tags-input__input" :placeholder="placeholder" :aria-label="label" />
  </TagsInputRoot>
</template>

<style>
.ui-tags-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-height: var(--control-md);
  padding: var(--space-1) var(--space-1-5);
  color: var(--color-text);
  font-size: var(--text-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.ui-tags-input:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.ui-tags-input[data-disabled] {
  opacity: 0.55;
}

.ui-tags-input__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  max-width: 100%;
  padding: var(--space-0-5) var(--space-1) var(--space-0-5) var(--space-1-5);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-accent-soft);
  border-radius: 999px;
}

.ui-tags-input__item[data-state="active"] {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.ui-tags-input__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-tags-input__delete {
  display: inline-grid;
  flex: none;
  place-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.ui-tags-input__delete:hover,
.ui-tags-input__delete:focus-visible {
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
  outline: none;
}

.ui-tags-input__input {
  flex: 1;
  min-width: 6rem;
  padding: var(--space-0-5) 0;
  color: inherit;
  font: inherit;
  background: transparent;
  border: 0;
  outline: none;
}

.ui-tags-input__input::placeholder {
  color: var(--color-text-secondary);
}
</style>
