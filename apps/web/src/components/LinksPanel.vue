<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import type { BacklinkGroup, LinkRecord } from "~/lib/links";

import { requestReveal } from "~/lib/reveal";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "openPage", id: string): void;
  (e: "openGraph"): void;
  (e: "close"): void;
}>();

const { t } = useI18n();
const { index, status, ensure } = useLinks();

/** Records and backlinks re-read when the index emits; the page id rebinds. */
const records = computed(() => {
  void status.value;
  void props.pageId;

  return index.value?.recordsFor(props.pageId) ?? [];
});

const backlinks = computed(() => {
  void status.value;
  void props.pageId;

  return index.value?.backlinksFor(props.pageId) ?? [];
});

const failing = computed(() => Boolean(status.value?.error) && !status.value?.ready);

onMounted(() => void ensure(props.store));
watch(
  () => props.store,
  (store) => void ensure(store),
);

function title(pageId: string): string {
  return props.store.getPage(pageId)?.title ?? pageId;
}

function openRecord(record: LinkRecord): void {
  if (record.targetId) emit("openPage", record.targetId);
}

/** Backlink mentions jump to the linking call, not the top of the note. */
function openMention(pageId: string, mention: LinkRecord): void {
  emit("openPage", pageId);
  requestReveal(pageId, mention.from, mention.to);
}

function mentionCount(group: BacklinkGroup): string {
  return t("links.mentions", { count: group.mentions.length });
}
</script>

<template>
  <section class="links" :aria-label="t('links.title')">
    <header class="links__header">
      <MsIcon name="link" :size="18" />
      <span class="links__title">{{ t("links.title") }}</span>
      <span class="links__counts">
        {{ t("links.countOutgoing", { count: records.length }) }} ·
        {{ t("links.countBacklinks", { count: backlinks.length }) }}
      </span>
      <div class="links__actions">
        <UiIconButton
          icon="hub"
          :label="t('links.openGraph')"
          variant="ghost"
          :size="18"
          @click="emit('openGraph')"
        />
        <UiIconButton
          icon="keyboard_arrow_down"
          :label="t('links.collapse')"
          variant="ghost"
          :size="18"
          @click="emit('close')"
        />
      </div>
    </header>

    <p v-if="failing" class="links__empty">{{ t("links.degraded") }}</p>

    <div v-else class="links__body">
      <section class="links__section" :aria-label="t('links.outgoing')">
        <h3 class="links__section-title">{{ t("links.outgoing") }}</h3>
        <p v-if="records.length === 0" class="links__empty">{{ t("links.noOutgoing") }}</p>
        <ul v-else class="links__list">
          <li v-for="record in records" :key="`${record.sourceId}:${record.from}`">
            <button type="button" class="links__row" @click="openRecord(record)">
              <MsIcon
                :name="record.kind === 'embed' ? 'article' : 'link'"
                :size="16"
                class="links__row-icon"
              />
              <span class="links__row-body">
                <span class="links__row-head">
                  <UiTruncatedText
                    class="links__row-title"
                    :text="record.targetId ? title(record.targetId) : record.target"
                  />
                  <span v-if="!record.targetId" class="links__dangling">
                    {{ t("links.dangling") }}
                  </span>
                </span>
                <span class="links__snippet"
                  ><span>{{ record.snippet.text.slice(0, record.snippet.from) }}</span
                  ><mark class="links__mark">{{
                    record.snippet.text.slice(record.snippet.from, record.snippet.to)
                  }}</mark
                  ><span>{{ record.snippet.text.slice(record.snippet.to) }}</span></span
                >
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section class="links__section" :aria-label="t('links.backlinks')">
        <h3 class="links__section-title">{{ t("links.backlinks") }}</h3>
        <p v-if="backlinks.length === 0" class="links__empty">{{ t("links.noBacklinks") }}</p>
        <ul v-else class="links__list">
          <li v-for="group in backlinks" :key="group.pageId" class="links__group">
            <button type="button" class="links__group-head" @click="emit('openPage', group.pageId)">
              <MsIcon name="description" :size="16" class="links__row-icon" />
              <UiTruncatedText class="links__row-title" :text="title(group.pageId)" />
              <span class="links__mentions">{{ mentionCount(group) }}</span>
            </button>
            <ul class="links__mentions-list">
              <li v-for="mention in group.mentions" :key="mention.from">
                <button
                  type="button"
                  class="links__row links__row--mention"
                  @click="openMention(group.pageId, mention)"
                >
                  <span class="links__snippet"
                    ><span>{{ mention.snippet.text.slice(0, mention.snippet.from) }}</span
                    ><mark class="links__mark">{{
                      mention.snippet.text.slice(mention.snippet.from, mention.snippet.to)
                    }}</mark
                    ><span>{{ mention.snippet.text.slice(mention.snippet.to) }}</span></span
                  >
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style>
.links {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 40%;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.links__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.links__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.links__counts {
  font-size: var(--text-xs);
}

.links__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  margin-left: auto;
}

.links__body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-2);
  padding: var(--space-2);
  overflow-y: auto;
}

.links__section {
  min-width: 0;
}

.links__section-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.links__list,
.links__mentions-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.links__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1);
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.links__row:hover {
  background: var(--color-surface-2);
}

.links__row--mention {
  padding-left: var(--space-4);
}

.links__row-icon {
  flex: none;
  margin-top: 2px;
  color: var(--color-text-secondary);
}

.links__row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.links__row-head {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  min-width: 0;
}

.links__row-title,
.links__group-head .links__row-title {
  font-weight: 500;
}

.links__dangling {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-warning);
}

.links__snippet {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.links__mark {
  padding: 0 2px;
  color: var(--color-text);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
}

.links__group-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1);
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.links__group-head:hover {
  background: var(--color-surface-2);
}

.links__mentions {
  flex: none;
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.links__empty {
  margin: 0;
  padding: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
