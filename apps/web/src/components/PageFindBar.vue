<script setup lang="ts">
const props = defineProps<{
  query: string;
  count: number;
  active: number;
}>();

const emit = defineEmits<{
  (e: "update:query", value: string): void;
  (e: "next"): void;
  (e: "prev"): void;
  (e: "close"): void;
}>();

const input = useTemplateRef("input");

function focus(): void {
  input.value?.focus();
  input.value?.input?.select();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }

  if (event.key !== "Enter") return;
  // The buttons run their own click on Enter.
  if ((event.target as HTMLElement | null)?.tagName === "BUTTON") return;

  event.preventDefault();
  if (event.shiftKey) emit("prev");
  else emit("next");
}

onMounted(focus);

defineExpose({ focus });
</script>

<template>
  <div class="page-find" role="search" @keydown="onKeydown">
    <UiTextField
      ref="input"
      :model-value="props.query"
      size="small"
      :placeholder="$t('pageView.findPlaceholder')"
      :aria-label="$t('pageView.find')"
      @update:model-value="emit('update:query', $event)"
    >
      <template #leading>
        <MsIcon name="search" :size="18" />
      </template>
    </UiTextField>

    <span class="page-find__count" role="status" aria-live="polite">
      {{
        count
          ? $t("pageView.findCount", { active: active + 1, count })
          : $t("pageView.findNoMatches")
      }}
    </span>

    <UiIconButton
      icon="keyboard_arrow_up"
      :label="$t('pageView.findPrevious')"
      variant="ghost"
      :size="20"
      :disabled="!count"
      @click="emit('prev')"
    />
    <UiIconButton
      icon="keyboard_arrow_down"
      :label="$t('pageView.findNext')"
      variant="ghost"
      :size="20"
      :disabled="!count"
      @click="emit('next')"
    />
    <UiIconButton
      icon="close"
      :label="$t('common.close')"
      variant="ghost"
      :size="20"
      @click="emit('close')"
    />
  </div>
</template>

<style>
.page-find {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1-5) var(--space-2);
  background: var(--color-surface-2);
  border-bottom: 1px solid var(--color-border);
}

.page-find .ui-text-field {
  max-width: 22rem;
}

.page-find__count {
  flex: none;
  min-width: 5.5rem;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  text-align: center;
  white-space: nowrap;
}

@media (max-width: 40rem) {
  .page-find {
    flex-wrap: wrap;
  }

  .page-find .ui-text-field {
    flex: 1 1 100%;
    max-width: none;
  }

  .page-find__count {
    min-width: 0;
    margin-right: auto;
    text-align: left;
  }
}
</style>
