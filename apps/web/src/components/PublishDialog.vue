<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { pushToast } from "~/composables/toasts";
import { publishPage, unpublishPage } from "~/lib/publish";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t, locale } = useI18n();
const { atproto } = useWorkspace();

const busy = ref(false);
const error = ref("");
const copied = ref(false);
const confirmOpen = ref(false);

const meta = useWorkspaceValue(
  () => props.store,
  ["pages"],
  (store) => store.getPage(props.pageId),
);

const langs = ref<string[]>([]);
const tags = ref<string[]>([]);
const includePdf = ref(false);

/** Options start from the workspace defaults each time the dialog opens. */
function syncOptions(): void {
  const defaults = props.store.getPublishSettings();
  langs.value = [...defaults.langs];
  tags.value = [...defaults.tags];
  includePdf.value = defaults.includePdf;
}

function formatPublished(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(timestamp));
}

async function onPublish() {
  if (!atproto.value || busy.value) return;

  busy.value = true;
  error.value = "";
  try {
    await publishPage(props.store, atproto.value, props.pageId, {
      langs: langs.value,
      tags: tags.value,
      includePdf: includePdf.value,
    });
    open.value = false;
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
    // Clipboard API is missing outside secure contexts, so the textarea trick
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
  open.value = false;
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

function saveDefaults(): void {
  props.store.updateSettings({
    publish: {
      langs: langs.value,
      tags: tags.value,
      includePdf: includePdf.value,
    },
  });
  pushToast({ titleKey: "common.saved", duration: 1800 });
}

watch(open, (value) => {
  if (!value) {
    copied.value = false;

    return;
  }

  error.value = "";
  copied.value = false;
  syncOptions();
});

watch(
  () => props.pageId,
  () => {
    open.value = false;
    error.value = "";
    copied.value = false;
    syncOptions();
  },
);
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="publish-dialog"
    :title="t('pageView.publish')"
    :description="t('pageView.publishHint')"
  >
    <div v-if="meta?.publishedAt" class="publish__status">
      <MsIcon name="public" :size="20" />
      <span>
        {{ t("pageView.publishedStatus", { date: formatPublished(meta.publishedAt) }) }}
      </span>
    </div>

    <div class="publish__options">
      <p class="publish__section-title">{{ t("pageView.publishOptions") }}</p>
      <label class="publish__field">
        <span>{{ t("settings.langs") }}</span>
        <UiTagsInput
          v-model="langs"
          :label="t('settings.langs')"
          placeholder="en, de"
          :disabled="busy"
        />
      </label>
      <label class="publish__field">
        <span>{{ t("settings.tags") }}</span>
        <UiTagsInput
          v-model="tags"
          :label="t('settings.tags')"
          :placeholder="t('settings.tags')"
          :disabled="busy"
        />
      </label>
      <div class="publish__options-footer">
        <UiCheckbox
          :model-value="includePdf"
          :label="t('settings.includePdf')"
          :disabled="busy"
          @update:model-value="includePdf = $event"
        />
        <UiButton size="tiny" variant="ghost" :disabled="busy" @click="saveDefaults">
          {{ t("pageView.saveDefaults") }}
        </UiButton>
      </div>
    </div>

    <p v-if="error" class="publish__error" role="alert">
      <MsIcon name="error" :size="20" />
      <span>{{ error }}</span>
    </p>

    <div class="dialog__actions publish-dialog__actions">
      <DialogClose as-child>
        <UiButton variant="ghost" size="small">{{ t("common.close") }}</UiButton>
      </DialogClose>
      <UiButton
        v-if="meta?.publishedAt"
        variant="ghost"
        size="small"
        :disabled="busy"
        @click="copyLink"
      >
        <MsIcon :name="copied ? 'check' : 'content_copy'" :size="20" />
        {{ copied ? t("common.copied") : t("pageView.copyLink") }}
      </UiButton>
      <UiButton
        v-if="meta?.publishedAt"
        variant="danger"
        size="small"
        :disabled="busy || !atproto"
        @click="askUnpublish"
      >
        {{ t("pageView.unpublish") }}
      </UiButton>
      <UiButton variant="primary" :disabled="busy || !atproto" @click="onPublish">
        {{
          busy
            ? t("pageView.publishWorking")
            : meta?.publishedAt
              ? t("pageView.republish")
              : t("pageView.publishToAtproto")
        }}
      </UiButton>
    </div>
  </UiDialog>

  <UiConfirmDialog
    v-model:open="confirmOpen"
    :title="t('pageView.unpublish')"
    :description="t('pageView.publishConfirm')"
    :confirm-label="t('pageView.unpublish')"
    @confirm="onUnpublish"
  />
</template>

<style>
/* Wide enough for the tag fields without filling a phone screen. */
.publish-dialog {
  width: min(30rem, calc(100vw - var(--space-8)));
}

.publish__options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.publish__section-title {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.publish__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.publish__options-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.publish-dialog__actions {
  flex-wrap: wrap;
}

/* Published state, above the options. */
.publish__status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.publish__status .ms-icon {
  flex: none;
  color: var(--color-accent);
}

/* Failures belong in the dialog, where the message can wrap. */
.publish__error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
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
</style>
