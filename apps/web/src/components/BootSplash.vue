<script setup lang="ts">
import type { BootStepState } from "~/composables/workspace";

const props = defineProps<{
  steps: BootStepState[];
  workspace?: string;
  note?: string;
  error?: unknown;
  slow?: boolean;
  retrying?: boolean;
}>();

const emit = defineEmits<{ retry: []; reload: []; chooseWorkspace: [] }>();

const detailsOpen = ref(false);

const errorMessage = computed(() => {
  if (!props.error) return "";

  return props.error instanceof Error ? props.error.message : String(props.error);
});
</script>

<template>
  <div class="app__splash" role="status" aria-live="polite">
    <div class="app__splash-inner">
      <div class="app__splash-heading">
        <h1 class="app__splash-title">
          {{ error ? $t("boot.failedTitle") : $t("boot.title") }}
        </h1>
        <p class="app__splash-workspace">
          <span v-if="workspace">{{ workspace }}</span>
          <span v-else class="app__splash-workspace-skeleton" aria-hidden="true" />
        </p>
      </div>

      <div class="app__splash-bar" :class="{ 'app__splash-bar--idle': error }" aria-hidden="true">
        <span />
      </div>

      <ol class="app__splash-steps">
        <li
          v-for="step in steps"
          :key="step.id"
          class="app__splash-step"
          :class="`app__splash-step--${step.status}`"
        >
          <span
            class="app__splash-step-mark"
            :class="`app__splash-step-mark--${step.status}`"
            aria-hidden="true"
          >
            <svg v-if="step.status === 'done'" class="app__splash-step-icon" viewBox="0 0 16 16">
              <path
                d="M3.5 8.5l3 3 6-7"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg
              v-else-if="step.status === 'error'"
              class="app__splash-step-icon"
              viewBox="0 0 16 16"
            >
              <path
                d="M8 4.5v4.5M8 11.5v.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="app__splash-step-label">{{ step.label }}</span>
        </li>
      </ol>

      <div class="app__splash-status">
        <template v-if="error">
          <p class="app__splash-error">{{ $t("boot.errorHint") }}</p>

          <UiCollapsible v-if="errorMessage" v-model:open="detailsOpen" class="app__splash-details">
            <template #trigger>
              <span>{{ $t("boot.errorDetails") }}</span>
            </template>
            <p class="app__splash-detail-text">{{ errorMessage }}</p>
          </UiCollapsible>

          <div class="app__splash-actions">
            <UiButton variant="primary" :disabled="retrying" @click="emit('retry')">
              {{ retrying ? $t("boot.retrying") : $t("boot.retry") }}
            </UiButton>
            <UiButton variant="ghost" @click="emit('chooseWorkspace')">
              {{ $t("boot.chooseWorkspace") }}
            </UiButton>
            <UiButton variant="ghost" @click="emit('reload')">{{ $t("engine.reload") }}</UiButton>
          </div>
        </template>

        <template v-else>
          <p v-if="note" class="app__splash-note">{{ note }}</p>

          <template v-if="slow">
            <p class="app__splash-note">{{ $t("boot.slowHint") }}</p>
            <div class="app__splash-actions">
              <UiButton variant="primary" @click="emit('reload')">
                {{ $t("engine.reload") }}
              </UiButton>
              <UiButton variant="ghost" @click="emit('chooseWorkspace')">
                {{ $t("boot.chooseWorkspace") }}
              </UiButton>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style>
.app__splash {
  position: fixed;
  inset: 0;
  z-index: var(--z-splash);
  display: grid;
  place-items: center;
  padding: calc(var(--space-6) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-6) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
  overflow: auto;
  background: var(--color-backdrop);
  color: var(--color-text);
  user-select: none;
}

.app__splash-inner {
  display: grid;
  justify-items: center;
  gap: var(--space-4);
  width: min(22rem, 100%);
}

.app__splash-heading {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  text-align: center;
}

.app__splash-title {
  display: grid;
  align-content: end;
  min-height: calc(var(--text-2xl) * 2 * var(--leading-tight));
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: var(--leading-tight);
  text-align: center;
}

.app__splash-workspace {
  max-width: 100%;
  min-height: calc(var(--text-lg) * var(--leading-snug));
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--text-lg);
  font-weight: 500;
  line-height: var(--leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app__splash-workspace-skeleton {
  display: inline-block;
  width: 7rem;
  height: 0.7em;
  vertical-align: middle;
  background: var(--color-border);
  border-radius: var(--radius-full);
  animation: app-splash-pulse 1.4s ease-in-out infinite;
}

@keyframes app-splash-pulse {
  50% {
    opacity: 0.45;
  }
}

.app__splash-bar {
  position: relative;
  width: 11rem;
  max-width: 100%;
  height: 0.25rem;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
}

.app__splash-bar--idle {
  visibility: hidden;
}

.app__splash-bar span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: var(--color-accent);
  border-radius: inherit;
  animation: app-splash-slide 1.1s ease-in-out infinite;
}

@keyframes app-splash-slide {
  0% {
    left: -40%;
  }

  100% {
    left: 100%;
  }
}

.app__splash-steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: fit-content;
  max-width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.app__splash-step {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
  align-items: start;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
}

.app__splash-step-label {
  overflow-wrap: anywhere;
}

.app__splash-step--pending {
  opacity: 0.5;
}

.app__splash-step--active {
  color: var(--color-text);
}

.app__splash-step--error {
  color: var(--color-danger);
}

.app__splash-step-mark {
  display: grid;
  place-content: center;
  box-sizing: border-box;
  width: 0.875rem;
  height: 0.875rem;
  margin-top: 0.125rem;
  border: 2px solid var(--color-border-strong);
  border-radius: 50%;
}

.app__splash-step-mark--active {
  border-color: var(--color-accent);
  border-top-color: transparent;
  animation: app-splash-spin 0.8s linear infinite;
}

.app__splash-step-mark--done {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.app__splash-step-mark--error {
  border-color: var(--color-danger);
  background: var(--color-danger);
  color: var(--color-on-danger);
}

.app__splash-step-icon {
  width: 0.65rem;
  height: 0.65rem;
}

@keyframes app-splash-spin {
  to {
    transform: rotate(360deg);
  }
}

.app__splash-status {
  display: grid;
  justify-items: center;
  align-content: start;
  gap: var(--space-2);
  width: 100%;
  min-height: 9.5rem;
}

.app__splash-error,
.app__splash-note {
  display: -webkit-box;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-align: center;
}

.app__splash-error {
  color: var(--color-text-secondary);
}

.app__splash-note {
  color: var(--color-text-secondary);
}

.app__splash-details {
  width: 100%;
}

.app__splash-details .ui-collapsible__trigger {
  justify-content: center;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.app__splash-details .ui-collapsible__trigger:hover {
  color: var(--color-text);
}

.app__splash-details .ui-collapsible__content[data-state="open"] {
  animation: app-splash-details-in var(--motion-fast);
}

@keyframes app-splash-details-in {
  from {
    opacity: 0;
    transform: translateY(calc(var(--space-1) * -1));
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.app__splash-detail-text {
  max-height: 7rem;
  margin: var(--space-2) 0 0;
  padding: var(--space-2);
  overflow: auto;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  line-height: var(--leading-snug);
  text-align: left;
  overflow-wrap: anywhere;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.app__splash-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.splash-leave-active {
  transition: opacity var(--motion-slow);
}

.splash-leave-to {
  opacity: 0;
}
</style>
