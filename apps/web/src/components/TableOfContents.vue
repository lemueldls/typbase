<script setup lang="ts">
import type { TextRef } from "@typbase/codemirror";
import type { FileId, HeadingSpan, TypstState } from "@typbase/engine";

import { headingsOf } from "~/lib/engineSyntax";

/**
 * The page outline. It extracts only while the popover is mounted, and parses
 * through the engine's shared tree (the same one highlight and the syntax
 * passes use), so an open outline does not add a parse per keystroke.
 */
const props = defineProps<{
  fileId: FileId;
  text: TextRef;
  typstState: TypstState;
}>();

const emit = defineEmits<{ (e: "jump", heading: HeadingSpan): void }>();

const { t } = useI18n();
const headings = ref<HeadingSpan[]>([]);
const failed = ref(false);

function extract(): void {
  try {
    headings.value = headingsOf(props.typstState, props.fileId, props.text.value);
    failed.value = false;
  } catch (cause) {
    console.error("[toc] extraction failed:", cause);
    headings.value = [];
    failed.value = true;
  }
}

const scheduleExtract = useDebounceFn(extract, 200);

onMounted(extract);
watch(() => props.text.value, scheduleExtract);
watch([() => props.typstState, () => props.fileId], () => {
  failed.value = false;
  extract();
});
</script>

<template>
  <div class="toc">
    <header class="toc__header">
      <MsIcon name="toc" :size="20" />
      <span class="toc__title">{{ t("toc.title") }}</span>
      <span class="toc__count">{{ t("toc.count", { count: headings.length }) }}</span>
    </header>

    <p v-if="failed" class="toc__empty">{{ t("toc.unavailable") }}</p>
    <p v-else-if="headings.length === 0" class="toc__empty">{{ t("toc.empty") }}</p>

    <nav v-else class="toc__list" :aria-label="t('toc.title')">
      <button
        v-for="heading in headings"
        :key="heading.from"
        type="button"
        class="toc__row"
        :class="`toc__row--${heading.level}`"
        :style="{ '--toc-indent': `${heading.level - 1}` }"
        @click="emit('jump', heading)"
      >
        <span class="toc__row-title">{{ heading.title }}</span>
      </button>
    </nav>
  </div>
</template>

<style>
.toc {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: min(60vh, 28rem);
}

.toc__header {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}

.toc__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.toc__count {
  margin-left: auto;
  font-size: var(--text-xs);
}

.toc__list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-1);
  overflow-y: auto;
}

.toc__row {
  display: block;
  width: 100%;
  padding: var(--space-1) var(--space-2);
  padding-left: calc(var(--space-2) + var(--toc-indent) * var(--space-3));
  overflow: hidden;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.toc__row:hover {
  background: var(--color-surface-2);
}

.toc__row--1 {
  font-weight: 600;
}

.toc__row--2 {
  font-weight: 500;
}

.toc__empty {
  margin: 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
