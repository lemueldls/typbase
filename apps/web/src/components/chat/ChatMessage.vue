<script setup lang="ts">
import type { ChatMessage as ChatMessageRecord, ChatToolRun } from "@typbase/typing";

import { summarizeDiagnostics } from "~/lib/ai/verify";

const props = defineProps<{
  message: ChatMessageRecord;
  /** HTML from the last progressive/final render, when there is one. */
  html?: string;
  tools: ChatToolRun[];
  streaming: boolean;
}>();

const emit = defineEmits<{
  (e: "insert"): void;
  (e: "createPage"): void;
  (e: "repair"): void;
}>();

const { t } = useI18n();
const sourceOpen = ref(false);
const toolsOpen = ref(false);
const toolNames = computed(() =>
  props.tools
    .map((tool) => tool.name)
    .join(", ")
    .slice(0, 80),
);

const isAssistant = computed(() => props.message.role === "assistant");
const hasSource = computed(() => props.message.source.trim().length > 0);
const busy = computed(
  () => props.message.status === "streaming" || props.message.status === "verifying",
);
const problem = computed(
  () => props.message.status === "unverified" || props.message.status === "error",
);

const statusLabel = computed(() => {
  switch (props.message.status) {
    case "streaming":
      return t("chat.statusStreaming");
    case "verifying":
      return t("chat.statusVerifying");
    case "repairing":
      return t("chat.statusRepairing");
    case "verified":
      return t("chat.statusVerified");
    case "unverified":
      return t("chat.statusUnverified");
    case "aborted":
      return t("chat.statusAborted");
    case "error":
      return t("chat.statusError");
    default:
      return "";
  }
});

async function copySource(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.message.source);
  } catch {
    // Clipboard permissions are optional; the source toggle still shows it.
  }
}
</script>

<template>
  <article
    v-if="message.role === 'user'"
    class="chat-message chat-message--user"
    :data-status="message.status"
  >
    <p class="chat-message__text">{{ message.source }}</p>
  </article>

  <article v-else class="chat-message chat-message--assistant" :data-status="message.status">
    <div v-if="message.repairOf" class="chat-message__badge">{{ $t("chat.repairBadge") }}</div>

    <div v-if="html" class="chat-message__render" v-html="html" />

    <div v-else-if="!hasSource && busy" class="chat-message__thinking" role="status">
      <span class="chat-message__spinner" aria-hidden="true" />
      <span>{{ statusLabel }}</span>
    </div>

    <pre v-else-if="hasSource" class="chat-message__raw">{{ message.source }}</pre>

    <details v-if="tools.length" class="chat-message__tools" :open="toolsOpen">
      <summary @click.prevent="toolsOpen = !toolsOpen">
        {{ $t("chat.toolsUsed", { count: tools.length }) }}
        <span v-if="toolNames"> · {{ toolNames }}</span>
      </summary>
      <div v-for="tool in tools" :key="tool.id" class="chat-message__tool">
        <code>{{ tool.name }}</code>
        <pre>{{ tool.output }}</pre>
      </div>
    </details>

    <div v-if="message.error" class="chat-message__error" role="alert">
      {{ message.error }}
    </div>

    <ul v-if="problem && message.diagnostics.length" class="chat-message__diagnostics">
      <li v-for="(diagnostic, index) in message.diagnostics.slice(0, 6)" :key="index">
        {{ diagnostic.message }}
      </li>
    </ul>

    <div class="chat-message__footer">
      <span class="chat-message__status" :data-status="message.status">
        <span v-if="busy" class="chat-message__spinner" aria-hidden="true" />
        <MsIcon
          v-else-if="message.status === 'verified'"
          name="check_circle"
          :size="14"
          aria-hidden="true"
        />
        <MsIcon v-else-if="problem" name="error" :size="14" aria-hidden="true" />
        <MsIcon v-else name="stop_circle" :size="14" aria-hidden="true" />
        {{ statusLabel }}
        <template v-if="message.status === 'unverified' && message.diagnostics.length">
          · {{ summarizeDiagnostics(message.diagnostics) }}
        </template>
      </span>

      <span class="chat-message__spacer" />

      <template v-if="isAssistant && hasSource && !streaming">
        <UiButton size="tiny" variant="ghost" @click="sourceOpen = !sourceOpen">
          {{ sourceOpen ? $t("chat.hideSource") : $t("chat.showSource") }}
        </UiButton>
        <UiButton size="tiny" variant="ghost" @click="copySource">
          {{ $t("chat.copy") }}
        </UiButton>
        <UiButton v-if="problem" size="tiny" variant="ghost" @click="emit('repair')">
          {{ $t("chat.repair") }}
        </UiButton>
        <UiButton size="tiny" variant="ghost" @click="emit('insert')">
          {{ $t("chat.insert") }}
        </UiButton>
        <UiButton size="tiny" variant="ghost" @click="emit('createPage')">
          {{ $t("chat.createPage") }}
        </UiButton>
      </template>
    </div>

    <pre v-if="sourceOpen" class="chat-message__source">{{ message.source }}</pre>
  </article>
</template>

<style scoped>
.chat-message {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3-5);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}

.chat-message--user {
  align-self: flex-end;
  max-width: min(85%, 42rem);
  background: var(--color-accent-soft);
  border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
}

.chat-message--assistant {
  align-self: stretch;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
}

.chat-message__text {
  margin: 0;
  white-space: pre-wrap;
}

.chat-message__render :deep(> :first-child) {
  margin-top: 0;
}

.chat-message__render :deep(> :last-child) {
  margin-bottom: 0;
}

.chat-message__render :deep(pre) {
  padding: var(--space-2);
  overflow: auto;
  background: var(--color-code);
  border-radius: var(--radius-sm);
}

.chat-message__render :deep(a) {
  color: var(--color-accent);
}

.chat-message__raw,
.chat-message__source {
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  background: var(--color-code);
  border-radius: var(--radius-sm);
}

.chat-message__source {
  max-height: 20rem;
}

.chat-message__thinking {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.chat-message__spinner {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
  border: 2px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: chat-spin 0.7s linear infinite;
}

@keyframes chat-spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-message__badge {
  align-self: flex-start;
  padding: 0 var(--space-1-5);
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-3);
  border-radius: var(--radius-full);
}

.chat-message__tools {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.chat-message__tools summary {
  cursor: pointer;
}

.chat-message__tool {
  margin-top: var(--space-1);
}

.chat-message__tool pre {
  max-height: 12rem;
  margin: var(--space-1) 0 0;
  padding: var(--space-1-5);
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  background: var(--color-code);
  border-radius: var(--radius-xs);
}

.chat-message__error {
  padding: var(--space-1-5) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.chat-message__diagnostics {
  margin: 0;
  padding-left: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.chat-message__footer {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.chat-message__spacer {
  flex: 1;
}

.chat-message__status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.chat-message__status[data-status="unverified"],
.chat-message__status[data-status="error"] {
  color: var(--color-danger);
}
</style>
