<script setup lang="ts">
import { dismissToast, useToasts } from "~/composables/toasts";

const toasts = useToasts();

function onOpenChange(id: string, open: boolean) {
  if (!open) dismissToast(id);
}
</script>

<template>
  <ToastProvider>
    <ToastViewport class="ui-toast__viewport">
      <ToastRoot
        v-for="toast in toasts"
        :key="toast.id"
        class="ui-toast"
        :class="{ 'ui-toast--danger': toast.variant === 'danger' }"
        :duration="toast.duration"
        @update:open="(open) => onOpenChange(toast.id, open)"
      >
        <div class="ui-toast__body">
          <ToastTitle class="ui-toast__title">{{ $t(toast.titleKey) }}</ToastTitle>
          <ToastDescription v-if="toast.descriptionKey" class="ui-toast__description">
            {{ $t(toast.descriptionKey) }}
          </ToastDescription>
          <div v-if="toast.actions?.length" class="ui-toast__actions">
            <UiButton
              v-for="action in toast.actions"
              :key="action.labelKey"
              size="small"
              variant="ghost"
              @click="action.onClick()"
            >
              {{ $t(action.labelKey) }}
            </UiButton>
          </div>
        </div>
        <button
          type="button"
          class="ui-toast__close"
          :aria-label="$t('common.close')"
          @click="dismissToast(toast.id)"
        >
          <MsIcon name="close" :size="20" />
        </button>
      </ToastRoot>
    </ToastViewport>
  </ToastProvider>
</template>

<style>
.ui-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: min(22rem, calc(100vw - var(--space-8)));
  padding: var(--space-3);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.18);
}

.ui-toast--danger {
  border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-border));
}

.ui-toast__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
}

.ui-toast__title {
  font-size: var(--text-md);
  font-weight: 600;
}

.ui-toast--danger .ui-toast__title {
  color: var(--color-danger);
}

.ui-toast__description {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.ui-toast__actions {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.ui-toast__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-xs);
  height: var(--control-xs);
  flex: none;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.ui-toast__close:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.ui-toast__viewport {
  position: fixed;
  right: calc(var(--space-4) + var(--safe-right));
  bottom: calc(var(--space-4) + var(--safe-bottom));
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  outline: none;
}
</style>
