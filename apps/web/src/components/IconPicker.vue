<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import { searchSymbols, type SymbolEntry } from "~/lib/symbols";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** How many results render before "refine your search" is shown. */
    limit?: number;
  }>(),
  { limit: 350 },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: MaterialSymbol): void;
}>();

const query = ref("");
const gridRef = useTemplateRef<HTMLElement>("grid");

const result = computed(() => searchSymbols(query.value, props.limit));

watch(query, () => {
  gridRef.value?.scrollTo({ top: 0 });
});

function pick(entry: SymbolEntry) {
  emit("update:modelValue", entry.id);
}

const selected = computed(() => props.modelValue as MaterialSymbol);
</script>

<template>
  <div class="icon-picker">
    <UiTextField
      v-model="query"
      type="search"
      :placeholder="$t('switcher.iconSearch')"
      :aria-label="$t('switcher.iconSearch')"
      @keydown.enter.prevent
    >
      <template #leading>
        <MsIcon name="search" :size="16" class="icon-picker__search-icon" />
      </template>
    </UiTextField>

    <div ref="grid" class="icon-picker__grid">
      <UiTooltip v-for="entry in result.entries" :key="entry.id" :text="entry.title">
        <button
          type="button"
          class="icon-picker__cell"
          :class="{ 'icon-picker__cell--selected': entry.id === selected }"
          :aria-pressed="entry.id === selected"
          :aria-label="entry.title"
          @click="pick(entry)"
        >
          <MsIcon :name="entry.id" :size="20" />
        </button>
      </UiTooltip>
    </div>

    <p v-if="result.total > result.entries.length" class="icon-picker__hint">
      {{ $t("switcher.iconMore", { shown: result.entries.length, total: result.total }) }}
    </p>
  </div>
</template>

<style>
.icon-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.icon-picker__search-icon {
  color: var(--color-text-secondary);
}

.icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.4rem, 1fr));
  gap: var(--space-1);
  max-height: 14rem;
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.icon-picker__cell {
  display: grid;
  place-content: center;
  aspect-ratio: 1;
  padding: var(--space-1);
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.icon-picker__cell:hover {
  background: var(--color-surface-3);
}

.icon-picker__cell--selected {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.icon-picker__hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
