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
const copied = ref(false);
const confirmOpen = ref(false);

const meta = computed(() => {
  void dataRevision.value;

  return props.store.getPage(props.pageId);
});

const menuOpen = ref(false);

function formatPublished(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(timestamp));
}

/** Tooltip: the action, plus the date once the page is published. */
const label = computed(() => {
  if (busy.value) return t("pageView.publishWorking");

  const page = meta.value;
  if (!page?.publishedAt) return t("pageView.publish");

  return `${t("pageView.republish")} · ${formatPublished(page.publishedAt)}`;
});

// Tint the trigger after a failed action; opening the popover shows the text.
const failed = computed(() => error.value.length > 0);

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

async function copyLink() {
  const uri = meta.value?.publishUri;
  if (!uri) return;

  try {
    await navigator.clipboard.writeText(uri);
  } catch {
    // Clipboard API is missing outside secure contexts; the textarea trick
    // still works in the Tauri webview.
    const area = document.createElement("textarea");
    area.value = uri;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function askUnpublish() {
  menuOpen.value = false;
  confirmOpen.value = true;
}

async function onUnpublish() {
  if (!atproto.value || busy.value) return;

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

watch(menuOpen, (open) => {
  if (!open) copied.value = false;
});

watch(
  () => props.pageId,
  () => {
    error.value = "";
    copied.value = false;
  },
);
</script>

<template>
  <div class="publish" v-if="atprotoStatus.signedIn">
    <UiPopover v-model:open="menuOpen" class="menu publish__menu" align="end" :side-offset="6">
      <template #trigger>
        <UiIconButton
          :icon="busy ? 'progress_activity' : meta?.publishedAt ? 'cloud_done' : 'cloud_upload'"
          :label="label"
          :disabled="busy"
          :danger="failed"
        />
      </template>

      <template v-if="meta?.publishedAt">
        <div class="publish__status">
          <MsIcon name="public" :size="16" />
          <span>
            {{ t("pageView.publishedStatus", { date: formatPublished(meta.publishedAt) }) }}
          </span>
        </div>
        <div class="menu__separator" />
      </template>

      <button type="button" class="menu__item" :disabled="busy || !atproto" @click="onPublish">
        <MsIcon name="cloud_upload" :size="20" />
        {{ meta?.publishedAt ? t("pageView.republish") : t("pageView.publishToAtproto") }}
      </button>

      <button v-if="meta?.publishedAt" type="button" class="menu__item" @click="copyLink">
        <MsIcon :name="copied ? 'check' : 'content_copy'" :size="20" />
        {{ copied ? t("common.copied") : t("pageView.copyLink") }}
      </button>

      <template v-if="meta?.publishedAt">
        <div class="menu__separator" />
        <button
          type="button"
          class="menu__item menu__danger"
          :disabled="busy || !atproto"
          @click="askUnpublish"
        >
          <MsIcon name="delete" :size="20" />
          {{ t("pageView.unpublish") }}
        </button>
      </template>

      <p v-if="error" class="publish__error" role="alert">
        <MsIcon name="error" :size="16" />
        <span>{{ error }}</span>
      </p>
      <!-- <p class="publish__hint">{{ t("pageView.publishHint") }}</p> -->
    </UiPopover>

    <UiConfirmDialog
      v-model:open="confirmOpen"
      :title="t('pageView.unpublish')"
      :description="t('pageView.publishConfirm')"
      :confirm-label="t('pageView.unpublish')"
      @confirm="onUnpublish"
    />
  </div>
</template>

<style>
.publish {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

/* Qualified with `.menu`: the surface styles come from Menu.vue and either
   file can land first in the bundle. */
.menu.publish__menu {
  min-width: 15rem;
}

/* Published state, above the actions. */
.publish__status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.publish__status .ms-icon {
  flex: none;
  color: var(--color-accent);
}

/* Failures belong in the popover, where the message can wrap. */
.publish__error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-1) 0 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
  overflow-wrap: anywhere;
}

.publish__error .ms-icon {
  flex: none;
  margin-top: 0.1rem;
}

.publish__hint {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-2-5) var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
