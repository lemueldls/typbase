<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { useWorkspace } from "~/composables/workspace";
import { publishPage, unpublishPage } from "~/lib/publish";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
}>();

const { atproto, atprotoStatus, dataRevision } = useWorkspace();

const busy = ref(false);
const error = ref("");

const meta = computed(() => {
  void dataRevision.value;

  return props.store.getPage(props.pageId);
});

const menuOpen = ref(false);

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

  if (
    !window.confirm(
      "Unpublish this note? Public records may be mirrored by firehose services and cannot be recalled.",
    )
  ) {
    return;
  }

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
  <div class="publish">
    <template v-if="atprotoStatus.signedIn">
      <span v-if="meta?.publishedAt" class="publish__status" :title="meta.publishUri ?? ''">
        Published {{ new Date(meta.publishedAt).toLocaleDateString() }}
      </span>

      <PopoverRoot v-model:open="menuOpen">
        <PopoverTrigger as-child>
          <button type="button" class="button button--small" :disabled="busy">
            {{ busy ? "Working…" : meta?.publishedAt ? "Republish" : "Publish" }}
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent class="menu publish__menu" :side-offset="6" align="end">
            <button type="button" class="menu__item" @click="onPublish">
              {{ meta?.publishedAt ? "Republish" : "Publish" }} to public atproto
            </button>
            <button
              v-if="meta?.publishedAt"
              type="button"
              class="menu__item menu__danger"
              @click="onUnpublish"
            >
              Unpublish
            </button>
            <p class="publish__hint">
              Public records are readable by anyone. Unpublishing deletes the record; firehose
              mirrors may retain copies.
            </p>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>

      <p v-if="error" class="publish__error">{{ error }}</p>
    </template>
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
  color: var(--text-secondary);
}

.publish__menu {
  min-width: 14rem;
}

.publish__hint {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.6rem 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.publish__error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--danger);
  max-width: 12rem;
}
</style>
