<script setup lang="ts">
import type { ChatMessage } from "@typbase/typing";

import { useChat, takeChatSeed } from "~/composables/chat";
import { pushToast } from "~/composables/toasts";
import { useWorkspace } from "~/composables/workspace";
import { engineAvailable } from "~/lib/engineHealth";
import { refreshSections, toSections } from "~/lib/sections";

const props = defineProps<{ threadId: string; docked?: boolean }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "expand"): void;
  (e: "openPage", id: string): void;
  (e: "openThread", id: string): void;
}>();

const { t } = useI18n();
const {
  threads,
  chatRevision,
  startThread,
  readMessages: readChatMessages,
  send,
  stop,
  repair,
  deleteThread,
  isStreaming,
  rendered,
  tools,
  providers,
} = useChat();
const { workspace } = useWorkspace();

const messages = ref<ChatMessage[]>([]);
const draft = ref("");
const selection = ref<string | null>(null);
const contextPageId = ref<string | null>(null);
const confirmDeleteOpen = ref(false);
const threadMenuOpen = ref(false);
const bodyRef = useTemplateRef<HTMLElement>("body");

const seed = takeChatSeed();
if (seed && seed.threadId === props.threadId) {
  selection.value = seed.selection;
  contextPageId.value = seed.pageId;
}

/** Thread metadata lives in the workspace doc's `chats` map, so title,
 *  provider, model, and page edits show up without an engine event. */
const thread = useWorkspaceValue(workspace, ["chats"], (store) => store.getChat(props.threadId));

const threadTitle = computed(() => thread.value?.title ?? t("chat.title"));
const busy = computed(() => isStreaming(props.threadId));
/** The page this thread is about; the open seed can override the stored id. */
const contextPage = useWorkspaceValue(
  workspace,
  ["pages"],
  (store) => {
    const id = contextPageId.value ?? thread.value?.pageId ?? null;

    return id ? (store.getPage(id) ?? null) : null;
  },
  null,
);
const pageTitle = computed(() => contextPage.value?.title ?? null);
/** All pages, for the composer's page picker. */
const pages = useWorkspaceValue(workspace, ["pages"], (store) => store.listPages(), []);

const providerId = computed(() => thread.value?.providerId ?? null);
const model = computed(() => thread.value?.model ?? null);
async function reload(): Promise<void> {
  messages.value = await readChatMessages(props.threadId);
}

async function scrollToBottom(smooth = false): Promise<void> {
  await nextTick();
  const body = bodyRef.value;
  if (!body) return;
  body.scrollTo({ top: body.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

watch(
  () => props.threadId,
  async () => {
    messages.value = [];
    await reload();
    await scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => chatRevision.value,
  async () => {
    await reload();
    if (busy.value) await scrollToBottom();
  },
);

// Remote sync or another window can change the thread doc.
let offDoc: (() => void) | undefined;
watch(
  () => props.threadId,
  (id) => {
    offDoc?.();
    offDoc = undefined;
    const store = workspace.value;
    if (!store) return;

    void store
      .onChatDocChange(id, () => void reload())
      .then((off) => {
        if (props.threadId === id) offDoc = off;
        else off();
      });
  },
  { immediate: true },
);

onScopeDispose(() => offDoc?.());

async function onSend(): Promise<void> {
  const text = draft.value.trim();
  if (!text || busy.value) return;
  if (!engineAvailable()) {
    pushToast({ titleKey: "chat.engineDown", variant: "danger", duration: 4000 });

    return;
  }

  draft.value = "";
  await scrollToBottom(true);
  try {
    await send(props.threadId, text, {
      pageId: contextPageId.value ?? thread.value?.pageId ?? null,
      selection: selection.value,
    });
  } catch (error) {
    console.error("[chat] send failed:", error);
    pushToast({ titleKey: "chat.sendFailed", variant: "danger", duration: 6000 });
    draft.value = text;
  }
}

function onStop(): void {
  stop(props.threadId);
}

function updateProvider(value: string): void {
  const store = workspace.value;
  if (!store) return;
  store.updateChat(props.threadId, { providerId: value });
}

function updateModel(value: string): void {
  const store = workspace.value;
  if (!store) return;
  store.updateChat(props.threadId, { model: value || null });
}

/** Re-grounds the thread on another page; a selection came from the old page
 *  and would be read against the wrong text. */
function updateContextPage(id: string | null): void {
  const current = contextPageId.value ?? thread.value?.pageId ?? null;
  contextPageId.value = id;
  if (id !== current) selection.value = null;
  workspace.value?.updateChat(props.threadId, { pageId: id });
}

async function insertMessage(message: ChatMessage): Promise<void> {
  const store = workspace.value;
  const pageId = contextPageId.value ?? thread.value?.pageId ?? null;
  if (!store || !pageId || !store.getPage(pageId)) {
    pushToast({ titleKey: "chat.needPage", duration: 4000 });

    return;
  }

  // Only the acceptance gate makes a reply safe to graft into a note; the
  // user can still insist, but the warning names the risk.
  if (message.status !== "verified" && !window.confirm(t("chat.insertUnverified"))) return;

  const current = await store.loadPageText(pageId);
  const separator = current.endsWith("\n") || current === "" ? "" : "\n";
  const next = `${current}${separator}${message.source}\n`;
  await store.setPageText(pageId, next);

  const typstState = await useTypst().catch(() => null);
  if (typstState) {
    await refreshSections(store, pageId, next, (source) =>
      engineAvailable() ? toSections(typstState.extractSections(source), source) : null,
    );
  }
  pushToast({ titleKey: "chat.inserted", duration: 2500 });
}

async function createPageFrom(message: ChatMessage): Promise<void> {
  const store = workspace.value;
  if (!store) return;

  const heading = message.source
    .split("\n")
    .find((line) => /^=+\s+/.test(line.trim()))
    ?.replace(/^=+\s+/, "")
    .trim();
  const page = await store.createPage({
    title: heading || t("chat.newPageTitle"),
    content: message.source,
  });
  emit("openPage", page.id);
}

async function newThread(): Promise<void> {
  const created = await startThread({
    pageId: contextPageId.value ?? thread.value?.pageId ?? null,
    providerId: providerId.value,
    model: model.value,
  });
  emit("openThread", created.id);
}

async function openThread(id: string): Promise<void> {
  threadMenuOpen.value = false;
  emit("openThread", id);
}

async function confirmDelete(): Promise<void> {
  await deleteThread(props.threadId);
  confirmDeleteOpen.value = false;
  emit("close");
}

const suggestions = computed(() => [
  t("chat.suggestionSummarize"),
  t("chat.suggestionFind"),
  t("chat.suggestionExplain"),
]);

function applySuggestion(text: string): void {
  draft.value = text;
}
</script>

<template>
  <div class="chat-pane" :class="{ 'chat-pane--docked': docked }">
    <div class="chat-pane__toolbar" data-tauri-drag-region="deep">
      <slot name="nav-toggle" />
      <!-- <MsIcon name="forum" :size="20" /> -->
      <UiTruncatedText class="chat-pane__title" :text="threadTitle" />

      <!-- <UiTooltip v-if="contextPage" :text="$t('chat.openContextPage')">
        <button type="button" class="chat-pane__context" @click="emit('openPage', contextPage.id)">
          <MsIcon name="description" :size="14" />
          <span class="chat-pane__context-title">
            {{ $t("chat.aboutPage", { title: contextPage.title }) }}
          </span>
        </button>
      </UiTooltip> -->

      <div class="chat-pane__actions">
        <UiMenu v-model:open="threadMenuOpen">
          <template #trigger>
            <UiIconButton icon="history" :label="$t('chat.threads')" />
          </template>
          <UiMenuItem v-for="entry in threads" :key="entry.id" @select="openThread(entry.id)">
            <MsIcon :name="entry.id === threadId ? 'forum' : 'chat_bubble'" :size="20" />
            <span class="chat-pane__thread-name">{{ entry.title }}</span>
          </UiMenuItem>
          <UiMenuSeparator />
          <UiMenuItem @select="newThread">
            <MsIcon name="add" :size="20" />
            {{ $t("chat.newThread") }}
          </UiMenuItem>
        </UiMenu>

        <UiIconButton icon="add_comment" :label="$t('chat.newThread')" @click="newThread" />
        <UiIconButton
          icon="delete"
          :label="$t('chat.deleteThread')"
          @click="confirmDeleteOpen = true"
        />
        <UiIconButton
          v-if="docked"
          icon="open_in_full"
          :label="$t('chat.expand')"
          @click="emit('expand')"
        />
        <UiIconButton icon="close" :label="$t('common.close')" @click="emit('close')" />
      </div>
    </div>

    <div ref="body" class="chat-pane__body">
      <div v-if="!messages.length" class="chat-pane__empty">
        <MsIcon name="forum" :size="32" />
        <p class="chat-pane__empty-title">{{ $t("chat.emptyTitle") }}</p>
        <p class="chat-pane__empty-hint">{{ $t("chat.emptyHint") }}</p>
        <div class="chat-pane__suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="chat-pane__suggestion"
            @click="applySuggestion(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <ChatMessage
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :html="rendered(message.id)"
        :tools="tools(message.id)"
        :streaming="message.status === 'streaming' || message.status === 'verifying'"
        @insert="insertMessage(message)"
        @create-page="createPageFrom(message)"
        @repair="repair(threadId, message.id)"
      />
    </div>

    <ChatComposer
      v-model="draft"
      :busy="busy"
      :providers="providers"
      :provider-id="providerId"
      :model="model"
      :page-title="pageTitle"
      :pages="pages"
      :selection="selection"
      @send="onSend"
      @stop="onStop"
      @update:provider-id="updateProvider"
      @update:model="updateModel"
      @update:page="updateContextPage"
      @clear-selection="selection = null"
    />

    <UiConfirmDialog
      v-model:open="confirmDeleteOpen"
      :title="$t('chat.deleteThread')"
      :description="$t('chat.deleteConfirm')"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style>
.chat-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chat-pane__toolbar {
  display: flex;
  align-items: center;
  min-height: var(--pane-header-height);
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.chat-pane__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  margin-left: var(--space-2);
  white-space: nowrap;
}

.chat-pane__context {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 16rem;
  margin-left: var(--space-2);
  padding: var(--space-0-5) var(--space-1-5);
  font: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.chat-pane__context:hover,
.chat-pane__context:focus-visible {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.chat-pane__context-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The dock is narrow: a smaller title leaves room for the page chip. */
.chat-pane--docked .chat-pane__title {
  font-size: var(--text-lg);
}

.chat-pane--docked .chat-pane__context {
  max-width: 10rem;
}

.chat-pane__actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.chat-pane__thread-name {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-pane__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3-5) var(--space-4);
  overflow-y: auto;
}

.chat-pane__empty {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  margin: auto;
  color: var(--color-text-secondary);
  text-align: center;
}

.chat-pane__empty-title {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}

.chat-pane__empty-hint {
  max-width: 28rem;
  margin: 0;
  font-size: var(--text-sm);
}

.chat-pane__suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-1-5);
  margin-top: var(--space-2);
}

.chat-pane__suggestion {
  padding: var(--space-1-5) var(--space-2-5);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
}

.chat-pane__suggestion:hover {
  background: var(--color-surface-3);
}
</style>
