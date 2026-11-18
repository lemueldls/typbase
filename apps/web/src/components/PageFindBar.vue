<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import type { FindOptions } from "~/lib/pageFind";

const props = defineProps<{
  query: string;
  count: number;
  active: number;
  replacement: string;
  options: FindOptions;
  /** Replace and select-all need an editable source pane. */
  editable: boolean;
  /** How many results can be replaced or selected in the editor. */
  replaceCount: number;
  /** Whether the active result has a source range to replace. */
  canReplace: boolean;
  /** The regexp pattern cannot be compiled. */
  invalid: boolean;
  /** Rendered text is unavailable, usually because the engine is down. */
  sourceOnly: boolean;
}>();

const emit = defineEmits<{
  (e: "update:query", value: string): void;
  (e: "update:replacement", value: string): void;
  (e: "update:options", value: FindOptions): void;
  (e: "next"): void;
  (e: "prev"): void;
  (e: "all"): void;
  (e: "replace"): void;
  (e: "replaceAll"): void;
  (e: "close"): void;
}>();

const input = useTemplateRef("input");
const replaceInput = useTemplateRef("replaceInput");
const root = useTemplateRef<HTMLElement>("root");
const replaceOpen = ref(false);
const { t } = useI18n();

const optionButtons = computed<
  Array<{ id: keyof FindOptions; icon: MaterialSymbol; label: string }>
>(() => [
  { id: "matchCase", icon: "match_case", label: t("pageView.findMatchCase") },
  { id: "regexp", icon: "regular_expression", label: t("pageView.findRegexp") },
  { id: "wholeWord", icon: "match_word", label: t("pageView.findWholeWord") },
]);

function focus(): void {
  input.value?.focus();
  input.value?.input?.select();
}

/** True while the caret is in the bar, not in the page behind it. */
function hasFocus(): boolean {
  return Boolean(root.value?.contains(document.activeElement));
}

function toggleOption(id: keyof FindOptions): void {
  const active = document.activeElement;
  const keepFocus =
    active === input.value?.input || (replaceOpen.value && active === replaceInput.value?.input);

  emit("update:options", { ...props.options, [id]: !props.options[id] });
  if (!keepFocus) focus();
}

function toggleReplace(): void {
  replaceOpen.value = !replaceOpen.value;
  void nextTick(() => {
    if (replaceOpen.value) replaceInput.value?.focus();
    else focus();
  });
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

  if ((event.target as HTMLElement | null)?.closest(".page-find__replace")) {
    emit("replace");
    return;
  }

  if (event.shiftKey) emit("prev");
  else emit("next");
}

onMounted(focus);

defineExpose({ focus, hasFocus });
</script>

<template>
  <div ref="root" class="page-find" role="search" @keydown="onKeydown">
    <UiTextField
      ref="input"
      class="page-find__input"
      :model-value="props.query"
      :placeholder="$t('pageView.findPlaceholder')"
      :aria-label="$t('pageView.find')"
      :aria-invalid="props.invalid || undefined"
      @update:model-value="emit('update:query', $event)"
    >
      <template #leading>
        <MsIcon name="search" :size="18" />
      </template>
    </UiTextField>

    <div class="page-find__options" role="group" :aria-label="$t('pageView.findOptions')">
      <UiIconButton
        v-for="option in optionButtons"
        :key="option.id"
        class="page-find__option"
        :icon="option.icon"
        :label="option.label"
        variant="ghost"
        :size="18"
        :pressed="props.options[option.id]"
        @mousedown.prevent
        @click="toggleOption(option.id)"
      />
    </div>

    <span
      class="page-find__count"
      :class="{ 'page-find__count--invalid': props.invalid }"
      role="status"
      aria-live="polite"
    >
      {{
        props.invalid
          ? $t("pageView.findInvalid")
          : count
            ? $t("pageView.findCount", { active: active + 1, count })
            : $t("pageView.findNoMatches")
      }}
    </span>

    <span v-if="sourceOnly" class="page-find__note">{{ $t("pageView.findSourceOnly") }}</span>

    <div class="page-find__nav">
      <UiIconButton
        icon="keyboard_arrow_up"
        :label="$t('pageView.findPrevious')"
        variant="ghost"
        :size="20"
        :disabled="!count"
        @mousedown.prevent
        @click="emit('prev')"
      />
      <UiIconButton
        icon="keyboard_arrow_down"
        :label="$t('pageView.findNext')"
        variant="ghost"
        :size="20"
        :disabled="!count"
        @mousedown.prevent
        @click="emit('next')"
      />
    </div>

    <div class="page-find__tools">
      <UiIconButton
        v-if="editable"
        icon="select_all"
        :label="$t('pageView.findAll')"
        variant="ghost"
        :size="20"
        :disabled="!replaceCount"
        @click="emit('all')"
      />
      <UiIconButton
        v-if="editable"
        class="page-find__replace-toggle"
        icon="find_replace"
        :label="$t('pageView.findReplace')"
        variant="ghost"
        :size="20"
        :pressed="replaceOpen"
        @click="toggleReplace"
      />
      <UiIconButton
        icon="close"
        :label="$t('common.close')"
        variant="ghost"
        :size="20"
        @click="emit('close')"
      />
    </div>

    <div v-if="editable && replaceOpen" class="page-find__replace">
      <UiTextField
        ref="replaceInput"
        class="page-find__replace-input"
        :model-value="props.replacement"
        :placeholder="$t('pageView.findReplacePlaceholder')"
        :aria-label="$t('pageView.findReplaceOne')"
        @update:model-value="emit('update:replacement', $event)"
      >
        <template #leading>
          <MsIcon name="find_replace" :size="18" />
        </template>
      </UiTextField>
      <UiButton
        variant="primary"
        :disabled="!canReplace"
        @mousedown.prevent
        @click="emit('replace')"
      >
        {{ $t("pageView.findReplaceOne") }}
      </UiButton>
      <UiButton
        variant="ghost"
        :disabled="!replaceCount"
        @mousedown.prevent
        @click="emit('replaceAll')"
      >
        {{ $t("pageView.findReplaceAll") }}
      </UiButton>
    </div>
  </div>
</template>

<style>
.page-find {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2) var(--space-2);
  background: var(--color-surface-2);
  /* border-bottom: 1px solid var(--color-border); */
}

.page-find__input {
  flex: 1 1 22rem;
  max-width: 34rem;
}

.page-find__input:has(input[aria-invalid="true"]) {
  border-color: var(--color-danger);
}

.page-find__options {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-md);
  padding: 0 var(--space-1);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.page-find__options .page-find__option {
  width: calc(var(--control-md) - var(--space-2));
  height: calc(var(--control-md) - var(--space-2));
  color: var(--color-text-secondary);
  border-radius: var(--radius-xs);
}

.page-find__options .page-find__option[aria-pressed="true"],
.page-find__tools .page-find__replace-toggle[aria-pressed="true"] {
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 34%, transparent);
}

.page-find__nav {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-0-5);
}

.page-find__tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-0-5);
  margin-left: auto;
  padding-left: var(--space-1);
  border-left: 1px solid var(--color-border);
}

.page-find__count {
  flex: none;
  min-width: 5.5rem;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  text-align: center;
  white-space: nowrap;
}

.page-find__count--invalid {
  color: var(--color-danger);
}

.page-find__note {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.page-find__replace {
  display: flex;
  flex: 1 1 100%;
  align-items: center;
  gap: var(--space-1-5);
}

.page-find__replace-input {
  flex: 1 1 22rem;
  max-width: 34rem;
}

@media (max-width: 40rem) {
  .page-find__input {
    order: 0;
    flex: 1 1 100%;
    max-width: none;
  }

  .page-find__options {
    order: 1;
  }

  .page-find__count {
    order: 2;
    min-width: 0;
    margin-right: auto;
    text-align: left;
  }

  .page-find__note {
    order: 3;
  }

  .page-find__nav {
    order: 4;
  }

  .page-find__tools {
    order: 5;
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }

  .page-find__replace {
    order: 6;
  }

  .page-find__replace-input {
    flex: 1 1 100%;
    max-width: none;
  }
}
</style>
