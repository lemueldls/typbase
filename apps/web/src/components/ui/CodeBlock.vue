<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    text: string;
    /** Accessible name and tooltip for the copy button. */
    label: string;
    /** Keep the value on one line, with an ellipsis when it does not fit. */
    truncate?: boolean;
  }>(),
  { truncate: false },
);

const { t } = useI18n();
const { copy, copied, isSupported } = useClipboard({
  source: () => props.text,
  copiedDuring: 1600,
});

const copyLabel = computed(() => (copied.value ? t("common.copied") : props.label));
</script>

<template>
  <div class="ui-code-block" :class="{ 'ui-code-block--truncate': truncate }">
    <code class="ui-code-block__text" :title="truncate ? text : undefined">{{ text }}</code>
    <UiIconButton
      :icon="copied ? 'check' : 'content_copy'"
      :label="copyLabel"
      variant="ghost"
      class="button--small ui-code-block__copy-button"
      :disabled="!isSupported"
      @click="copy()"
    />
    <slot name="actions" />
  </div>
</template>

<style>
.ui-code-block {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-height: var(--control-md);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.ui-code-block__text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.ui-code-block--truncate .ui-code-block__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow-wrap: normal;
}

.ui-code-block__copy-button {
  border-radius: var(--radius-xs);
}
</style>
