<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { publishPage, unpublishPage } from "~/lib/publish";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
}>();

const { t, locale } = useI18n();
const { atproto, atprotoStatus, dataRevision } = useWorkspace();

const busy = ref(false);
const error = ref("");

const meta = computed(() => {
  void dataRevision.value;

  return props.store.getPage(props.pageId);
});

const menuOpen = ref(false);

function formatPublished(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(timestamp));
}

async function onPublish() {
  if (!atproto.value || busy.value) return;

  busy.value = true;
  error.value = "";
  try {
    await publishPage(props.store, atproto.value, props.pageId);
    menuOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function onUnpublish() {
  if (!atproto.value || busy.value) return;

  if (!window.confirm(t("pageView.publishConfirm"))) return;

  busy.value = true;
  error.value = "";
  try {
    await unpublishPage(props.store, atproto.value, props.pageId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="publish" v-if="atprotoStatus.signedIn">
    <UiTooltip v-if="meta?.publishedAt" :text="meta.publishUri ?? ''">
      <span class="publish__status" role="status">
        <MsIcon name="public" :size="14" />
        {{ t("pageView.published", { date: formatPublished(meta.publishedAt) }) }}
      </span>
    </UiTooltip>

    <PopoverRoot v-model:open="menuOpen">
      <PopoverTrigger as-child>
        <button type="button" class="button button--small" :disabled="busy">
          {{
            busy
              ? t("pageView.publishWorking")
              : meta?.publishedAt
                ? t("pageView.republish")
                : t("pageView.publish")
          }}
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="menu publish__menu" :side-offset="6" align="end">
          <button type="button" class="menu__item" @click="onPublish">
            {{ meta?.publishedAt ? t("pageView.republish") : t("pageView.publish") }}
            · {{ t("pageView.publishToAtproto") }}
          </button>
          <button
            v-if="meta?.publishedAt"
            type="button"
            class="menu__item menu__danger"
            @click="onUnpublish"
          >
            {{ t("pageView.unpublish") }}
          </button>
          <p class="publish__hint">{{ t("pageView.publishHint") }}</p>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <p v-if="error" class="publish__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.publish {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.publish__status {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.publish__menu {
  min-width: 14rem;
}

.publish__hint {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.6rem 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.publish__error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-danger);
  max-width: 12rem;
}
</style>
