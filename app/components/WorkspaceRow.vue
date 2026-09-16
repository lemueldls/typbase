<script setup lang="ts">
import type { WorkspaceInfo } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

const props = defineProps<{
  info: WorkspaceInfo;
  /** This workspace is the active one. */
  active: boolean;
  /** A switch to this workspace is in flight. */
  switching: boolean;
  /** The select button is disabled (another switch is in flight). */
  disabled?: boolean;
  /** Ready-made status label: "current" or the opened date. */
  status: string;
}>();

const emit = defineEmits<{
  (e: "select"): void;
  (e: "rename"): void;
  (e: "remove"): void;
}>();

const { t } = useI18n();

const icon = computed(
  () => (props.info.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON,
);
</script>

<template>
  <div class="ws-row" :class="{ 'ws-row--active': active }">
    <button
      type="button"
      class="ws-row__open"
      :disabled="disabled"
      :aria-current="active ? 'true' : undefined"
      @click="emit('select')"
    >
      <span class="ws-row__icon" aria-hidden="true">
        <MsIcon :name="icon" :size="18" />
      </span>
      <span class="ws-row__text">
        <span class="ws-row__name">{{ info.name }}</span>
        <span class="ws-row__meta">{{ status }}</span>
      </span>
      <span v-if="switching" class="ws-row__spinner" aria-hidden="true" />
      <!-- <MsIcon v-else-if="active" name="check" :size="16" class="ws-row__check" /> -->
    </button>

    <UiMenu>
      <template #trigger>
        <UiIconButton
          icon="more_vert"
          :size="18"
          :label="t('switcher.actions', { name: info.name })"
          variant="ghost"
          class="button--small ws-row__more"
          @click.stop
        />
      </template>

      <UiMenuItem icon="edit" @select="emit('rename')">{{ $t("common.rename") }}</UiMenuItem>
      <UiMenuSeparator />
      <UiMenuItem icon="delete" danger @select="emit('remove')">
        {{ $t("common.delete") }}
      </UiMenuItem>
    </UiMenu>
  </div>
</template>

<style scoped>
.ws-row {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding-right: 0.3rem;
  border-radius: 0.45rem;
  transition: background 0.12s ease;
}

/* The highlight covers the whole row, trailing actions included, so the row
   reads as one button surface instead of a button plus a bystander. */
.ws-row:hover {
  background: var(--color-surface-2);
}

.ws-row--active,
.ws-row--active:hover {
  background: var(--color-accent-soft);
}

.ws-row__open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  font-family: inherit;
  font-size: 0.9rem;
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: 0.45rem;
  cursor: pointer;
}

.ws-row__open:disabled {
  opacity: 0.6;
  cursor: default;
}

.ws-row__icon {
  display: grid;
  place-content: center;
  width: 1.9rem;
  height: 1.9rem;
  flex: none;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: 0.4rem;
}

.ws-row--active .ws-row__icon {
  background: var(--color-surface);
}

.ws-row__text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.ws-row__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-row__meta {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.ws-row__check {
  flex: none;
  margin-left: auto;
  color: var(--color-accent);
}

/* :deep() targets UiIconButton's inner button; component-wrapped buttons do
   not receive the consumer's scope attribute. */
.ws-row :deep(.ws-row__more) {
  flex: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* Tint the row's own surface instead of painting the ghost button background
   over it, so the action stays visually inside the row highlight. */
.ws-row :deep(.ws-row__more:hover),
.ws-row :deep(.ws-row__more[data-state="open"]) {
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
}

.ws-row:hover :deep(.ws-row__more),
.ws-row :deep(.ws-row__more:focus-visible),
.ws-row :deep(.ws-row__more[data-state="open"]) {
  opacity: 1;
}

.ws-row__spinner {
  flex: none;
  width: 0.95rem;
  height: 0.95rem;
  margin-left: auto;
  border: 2px solid var(--color-text-secondary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ws-row-spin 0.7s linear infinite;
}

@keyframes ws-row-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (hover: none) {
  .ws-row :deep(.ws-row__more) {
    opacity: 1;
  }
}
</style>
