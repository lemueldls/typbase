<script setup lang="ts">
const { atprotoStatus, atprotoReady } = useWorkspace();
const accountDialog = useAccountDialog();

const { t } = useI18n();
const open = ref(false);

const profile = computed(() => atprotoStatus.value.profile);
const activeAccount = computed(() =>
  atprotoStatus.value.accounts.find((account) => account.did === atprotoStatus.value.did),
);
const avatar = computed(() => profile.value?.avatar ?? activeAccount.value?.avatar ?? null);
const avatarFailed = ref(false);
watch(avatar, () => {
  avatarFailed.value = false;
});
const accountName = computed(
  () =>
    profile.value?.displayName ||
    activeAccount.value?.displayName ||
    profile.value?.handle ||
    activeAccount.value?.handle ||
    atprotoStatus.value.did ||
    "",
);
const handle = computed(() => profile.value?.handle ?? activeAccount.value?.handle ?? null);

const statusLine = computed(() => {
  if (atprotoStatus.value.error) return atprotoStatus.value.error;
  if (!atprotoStatus.value.syncing) return t("settings.syncOff");
  if (atprotoStatus.value.pendingUpdates > 0) {
    return t("settings.syncPendingCount", { count: atprotoStatus.value.pendingUpdates });
  }

  return t("settings.syncInSync");
});

function manageAccount(): void {
  open.value = false;
  accountDialog.show(atprotoStatus.value.signedIn ? "accounts" : "signin");
}

function showData(): void {
  open.value = false;
  accountDialog.show("data");
}

function openProfile(): void {
  const did = atprotoStatus.value.did;
  if (!did) return;

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
            v-if="avatar && !avatarFailed"
            class="app-bar-account__avatar"
            :src="avatar"
            alt=""
            @error="avatarFailed = true"
          />
          <MsIcon v-else :name="icon" :size="18" />
        </button>
      </UiTooltip>
    </template>

    <div class="app-bar-account__card">
      <template v-if="atprotoStatus.signedIn">
        <div class="app-bar-account__identity">
          <img
            v-if="avatar && !avatarFailed"
            class="app-bar-account__card-avatar"
            :src="avatar"
            alt=""
            @error="avatarFailed = true"
          />
          <MsIcon
            v-else
            class="app-bar-account__card-avatar app-bar-account__card-avatar--placeholder"
            name="account_circle"
            :size="40"
          />
          <div class="app-bar-account__copy">
            <span class="app-bar-account__name">{{ accountName }}</span>
            <span v-if="handle" class="app-bar-account__handle">@{{ handle }}</span>
            <span class="app-bar-account__did">{{ atprotoStatus.did }}</span>
          </div>
        </div>

        <p class="app-bar-account__status">{{ statusLine }}</p>

        <UiButton variant="primary" class="app-bar-account__wide" @click="manageAccount">
          {{ $t("account.manage") }}
        </UiButton>

        <div class="app-bar-account__links">
          <!-- <button type="button" class="app-bar-account__link" @click="showData">
            {{ $t("account.whatWrites") }}
          </button> -->
          <button type="button" class="app-bar-account__link" @click="openProfile">
            {{ $t("account.viewProfile") }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="app-bar-account__status">{{ $t("account.appBarSignedOut") }}</p>
        <UiButton variant="primary" class="app-bar-account__wide" @click="manageAccount">
          {{ $t("account.signIn") }}
        </UiButton>
        <!-- <button type="button" class="app-bar-account__link" @click="showData">
          {{ $t("account.whatWrites") }}
        </button> -->
      </template>
    </div>
  </UiPopover>
</template>

<style>
.app-bar-account {
  z-index: 65;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - var(--space-4)));
  max-height: calc(100dvh - var(--app-bar-height) - var(--space-8));
  overflow-y: auto;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-2);
  animation: ui-overlay-fade-in var(--motion-fast);
}

.app-bar-account__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.app-bar-account__identity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.app-bar-account__card-avatar {
  width: 40px;
  height: 40px;
  flex: none;
  object-fit: cover;
  border-radius: 50%;
}

.app-bar-account__card-avatar--placeholder {
  color: var(--color-text-tertiary);
}

.app-bar-account__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-bar-account__name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.app-bar-account__handle {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.app-bar-account__did {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}

.app-bar-account__status {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.app-bar-account__wide {
  width: 100%;
}

.app-bar-account__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}

.app-bar-account__link {
  padding: 0;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-accent);
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.app-bar-account__link:hover {
  text-decoration: underline;
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
  width: 75%;
  height: 75%;
  object-fit: cover;
  border-radius: 50%;
}
</style>
