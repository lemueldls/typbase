<script setup lang="ts">
const { atprotoStatus, atprotoReady } = useWorkspace();

const { t } = useI18n();
const open = ref(false);

const profile = computed(() => atprotoStatus.value.profile);
const avatarFailed = ref(false);
watch(
  () => profile.value?.avatar,
  () => {
    avatarFailed.value = false;
  },
);
const accountName = computed(
  () => profile.value?.displayName || profile.value?.handle || atprotoStatus.value.did || "",
);

function openProfile(did: string): void {
  open.value = false;
  void navigateTo(`/u/${did}`);
}

const icon = computed<"account_circle" | "cloud_done" | "sync" | "sync_disabled">(() => {
  if (!atprotoReady.value) return "account_circle";
  if (atprotoStatus.value.error) return "sync_disabled";
  if (!atprotoStatus.value.signedIn) return "account_circle";
  if (atprotoStatus.value.syncing) return "sync";

  return "cloud_done";
});

const tone = computed(() => {
  if (atprotoStatus.value.error) return "app-bar-account--error";
  if (atprotoStatus.value.signedIn) return "app-bar-account--on";

  return "";
});

const label = computed(() => {
  if (!atprotoReady.value) return t("nav.accountUnavailable");
  if (atprotoStatus.value.error) return t("nav.accountSyncError");
  if (!atprotoStatus.value.signedIn) return t("nav.accountSignedOut");
  if (atprotoStatus.value.syncing) return t("nav.accountSyncing");

  return accountName.value
    ? t("nav.accountSignedInAs", { name: accountName.value })
    : t("nav.accountSignedIn");
});
</script>

<template>
  <UiPopover v-model:open="open" align="end" :side-offset="6" class="app-bar-account">
    <template #trigger>
      <UiTooltip :text="label">
        <button type="button" class="app-bar-account__trigger" :class="tone">
          <img
            v-if="profile?.avatar && !avatarFailed"
            class="app-bar-account__avatar"
            :src="profile.avatar"
            alt=""
            @error="avatarFailed = true"
          />
          <MsIcon v-else :name="icon" :size="18" />
        </button>
      </UiTooltip>
    </template>

    <SyncPanel @open-profile="openProfile" />
  </UiPopover>
</template>

<style>
.app-bar-account {
  z-index: 65;
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - var(--space-4)));
  max-height: calc(50dvh - var(--space-8));
  overflow-y: auto;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  animation: ui-overlay-fade-in var(--motion-fast);
}

.app-bar-account__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--motion-fast),
    color var(--motion-fast);
}

.app-bar-account__trigger:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.app-bar-account--on {
  color: var(--color-accent);
}

.app-bar-account--error {
  color: var(--color-danger);
}

.app-bar-account__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
</style>
