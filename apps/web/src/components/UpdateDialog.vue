<script setup lang="ts">
import { downloadFraction, formatBytes } from "~/lib/updates";

const { t } = useI18n();
const { open, status, info, progress, error, start, retry, dismiss, isPermissionError } =
  useAppUpdates();

const fraction = computed(() => downloadFraction(progress.value));
const percent = computed(() => (fraction.value === null ? null : Math.round(fraction.value * 100)));

const versionLine = computed(() => {
  const current = info.value;
  if (!current) return "";

  if (current.play) return t("updates.playAvailable");
  if (current.version && current.currentVersion) {
    return t("updates.availableCurrent", {
      version: current.version,
      current: current.currentVersion,
    });
  }
  if (current.version) return t("updates.available", { version: current.version });

  return "";
});

const sizeLine = computed(() =>
  info.value?.size ? t("updates.size", { size: formatBytes(info.value.size) }) : "",
);

const downloadLine = computed(() => {
  const current = progress.value;
  if (!current) return t("updates.downloading");

  if (percent.value !== null) return t("updates.downloadingPercent", { percent: percent.value });

  return t("updates.downloadingBytes", {
    downloaded: formatBytes(current.downloaded),
    total: current.total ? formatBytes(current.total) : "?",
  });
});

const errorLine = computed(() => {
  if (isPermissionError()) return t("updates.permissionDenied");
  return error.value ? `${t("updates.failed")} ${error.value}` : t("updates.failed");
});

const busy = computed(() => status.value === "downloading" || status.value === "installing");
</script>

<template>
  <UiDialog v-model:open="open" layer="top" :title="$t('updates.title')">
    <div class="update">
      <template v-if="status === 'checking'">
        <p class="update__line">{{ $t("updates.checking") }}</p>
      </template>

      <template v-else-if="status === 'available'">
        <p class="update__line">{{ versionLine }}</p>
        <p v-if="sizeLine" class="update__meta">{{ sizeLine }}</p>
        <p v-if="info?.play" class="update__meta">{{ $t("updates.playHint") }}</p>

        <template v-if="info?.notes">
          <h4 class="update__notes-title">{{ $t("updates.notes") }}</h4>
          <p class="update__notes">{{ info.notes }}</p>
        </template>
      </template>

      <template v-else-if="status === 'downloading'">
        <p class="update__line">{{ downloadLine }}</p>
        <div
          class="update__bar"
          role="progressbar"
          :aria-label="$t('updates.downloading')"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="percent ?? undefined"
        >
          <span
            class="update__bar-fill"
            :class="{ 'update__bar-fill--unknown': fraction === null }"
            :style="fraction === null ? undefined : { width: `${percent}%` }"
          />
        </div>
      </template>

      <template v-else-if="status === 'installing'">
        <p class="update__line">{{ $t("updates.installing") }}</p>
      </template>

      <template v-else-if="status === 'error'">
        <p class="update__line dialog__error">{{ errorLine }}</p>
      </template>

      <div class="dialog__actions">
        <UiButton v-if="!busy" variant="ghost" @click="dismiss">
          {{ status === "available" ? $t("updates.later") : $t("common.close") }}
        </UiButton>
        <UiButton v-if="status === 'available'" variant="primary" @click="start">
          {{ info?.play ? $t("updates.playInstall") : $t("updates.install") }}
        </UiButton>
        <UiButton v-else-if="status === 'error'" variant="primary" @click="retry">
          {{ $t("updates.retry") }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.update {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.update__line {
  margin: 0;
  font-size: var(--text-md);
}

.update__meta {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.update__notes-title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-md);
}

.update__notes {
  max-height: 12rem;
  margin: 0;
  overflow-y: auto;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}

.update__bar {
  position: relative;
  height: 4px;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
}

.update__bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--color-accent);
  border-radius: inherit;
  transition: width 120ms linear;
}

.update__bar-fill--unknown {
  width: 40%;
  animation: update-bar-slide 1.1s ease-in-out infinite;
}

@keyframes update-bar-slide {
  0% {
    left: -40%;
  }

  100% {
    left: 100%;
  }
}
</style>
