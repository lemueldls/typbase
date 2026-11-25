<script setup lang="ts">
import type { BootStepState } from "~/composables/workspace";

const props = defineProps<{
  steps: BootStepState[];
  note?: string;
  error?: unknown;
  retrying?: boolean;
}>();

const emit = defineEmits<{ retry: []; reload: [] }>();

const errorMessage = computed(() => {
  if (!props.error) return "";

  return props.error instanceof Error ? props.error.message : String(props.error);
});
</script>

<template>
  <div class="app__splash" role="status" aria-live="polite">
    <div class="app__splash-inner">
      <h1 class="app__splash-title">
        {{ error ? $t("boot.failedTitle") : $t("boot.title") }}
      </h1>

      <div v-if="!error" class="app__splash-bar" aria-hidden="true"><span /></div>

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

      <p v-if="errorMessage" class="app__splash-error">{{ errorMessage }}</p>
      <p v-if="note" class="app__splash-note">{{ note }}</p>

      <div v-if="error" class="app__splash-actions">
        <UiButton variant="primary" :disabled="retrying" @click="emit('retry')">
          {{ retrying ? $t("boot.retrying") : $t("boot.retry") }}
        </UiButton>
        <UiButton variant="ghost" @click="emit('reload')">{{ $t("engine.reload") }}</UiButton>
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
  width: min(20rem, 100%);
}

.app__splash-title {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: center;
}

.app__splash-bar {
  position: relative;
  width: 100%;
  height: 0.25rem;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
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
  width: 100%;
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

.app__splash-error,
.app__splash-note {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-align: center;
}

.app__splash-error {
  color: var(--color-danger);
}

.app__splash-note {
  color: var(--color-text-secondary);
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
