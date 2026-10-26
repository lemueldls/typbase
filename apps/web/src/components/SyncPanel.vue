<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import type { AtprotoAccount, WorkspaceSpaceSummary } from "~/lib/atproto";

import { pushToast } from "~/composables/toasts";
import { formatAgo } from "~/lib/format";
import { openExternal } from "~/lib/openExternal";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

/**
 * Sign-in and account details. The sign-in form is shared with the website
 * dashboard so both surfaces use the same handle normalization and errors.
 */
const { t, locale } = useI18n();
const { atproto, atprotoStatus, atprotoReady, joinWorkspace, workspaceId, workspaces } =
  useWorkspace();
const settingsDialog = useSettingsDialog();

const emit = defineEmits<{
  (e: "open-profile", did: string): void;
}>();

const profile = computed(() => atprotoStatus.value.profile);
const activeAccount = computed(
  () =>
    atprotoStatus.value.accounts.find((account) => account.did === atprotoStatus.value.did) ?? null,
);
const activeHandle = computed(() => profile.value?.handle ?? activeAccount.value?.handle ?? null);
const activeAvatar = computed(() => profile.value?.avatar ?? activeAccount.value?.avatar ?? null);
const profileName = computed(
  () =>
    profile.value?.displayName ||
    activeAccount.value?.displayName ||
    profile.value?.handle ||
    activeAccount.value?.handle ||
    shortDid(atprotoStatus.value.did),
);

const SPACES_ALPHA_URL = "https://atproto.com/blog/atproto-spaces-alpha";

const otherAccounts = computed(() =>
  atprotoStatus.value.accounts.filter((account) => account.did !== atprotoStatus.value.did),
);
const addAccountOpen = ref(false);
const switchBusy = ref<string | null>(null);
const signingOut = ref(false);
const removing = ref(false);
const accountError = ref("");
const removeTarget = ref<AtprotoAccount | null>(null);
const removeOpen = ref(false);
const accountBusy = computed(() => switchBusy.value !== null || signingOut.value || removing.value);

function accountName(account: AtprotoAccount): string {
  return account.displayName || account.handle || shortDid(account.did);
}

async function onSwitchAccount(did: string): Promise<void> {
  if (accountBusy.value || did === atprotoStatus.value.did) return;
  switchBusy.value = did;
  accountError.value = "";
  try {
    await atproto.value?.switchAccount(did);
    addAccountOpen.value = false;
  } catch (cause) {
    accountError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    switchBusy.value = null;
  }
}

function toggleAddAccount(): void {
  addAccountOpen.value = !addAccountOpen.value;
  if (addAccountOpen.value) accountError.value = "";
}

function askRemoveAccount(account: AtprotoAccount): void {
  removeTarget.value = account;
  removeOpen.value = true;
}

async function confirmRemoveAccount(): Promise<void> {
  const account = removeTarget.value;
  if (!account) return;
  removeTarget.value = null;
  removeOpen.value = false;
  removing.value = true;
  accountError.value = "";
  try {
    await atproto.value?.removeAccount(account.did);
  } catch (cause) {
    accountError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    removing.value = false;
  }
}

async function onSignOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  accountError.value = "";
  try {
    await atproto.value?.signOut();
  } catch (cause) {
    accountError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    signingOut.value = false;
  }
}

watch(
  () => atprotoStatus.value.did,
  () => {
    addAccountOpen.value = false;
    accountError.value = "";
  },
);

/** DIDs are long, so show the method prefix and the tail. */
function shortDid(did: string | null): string {
  if (!did) return "";

  return did.length > 18 ? `${did.slice(0, 10)}...${did.slice(-6)}` : did;
}

function ago(timestamp: number): string {
  return timestamp ? formatAgo(timestamp, locale.value) : t("settings.syncNever");
}

/** The service names Spaces when the PDS cannot host the workspace space. */
const spacesUnsupported = computed(() => /spaces/i.test(atprotoStatus.value.error ?? ""));

const spaces = ref<WorkspaceSpaceSummary[]>([]);
const spacesLoading = ref(false);
const spacesError = ref("");
const joinInput = ref("");
const joining = ref(false);

const spaceUri = computed(() => atprotoStatus.value.spaceUri);
const currentSpaceId = computed(() => spaceUri.value?.split("/").pop() ?? workspaceId.value);
const exporting = computed(() => atprotoStatus.value.pendingUpdates > 0);
const statusLabel = computed(() =>
  exporting.value ? t("settings.syncExporting") : t("settings.syncInSync"),
);

function workspaceName(id: string): string {
  return workspaces.value.find((entry) => entry.id === id)?.name ?? "";
}

function spaceLabel(space: WorkspaceSpaceSummary): string {
  return (
    workspaceName(space.id) || space.name || `${t("settings.syncSharedWorkspace")} ${space.id}`
  );
}

function isCurrentSpace(id: string): boolean {
  return id === currentSpaceId.value;
}

function spaceIcon(id: string): MaterialSymbol {
  const icon = workspaces.value.find((entry) => entry.id === id)?.icon;

  return (icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
}

function spaceStyle(id: string): Record<string, string> | undefined {
  const accent = workspaces.value.find((entry) => entry.id === id)?.accent;

  return accent ? { "--ws-accent": accent } : undefined;
}

/** A pasted space URI or a bare workspace id. */
function parseSpaceId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("at://")) {
    const match = trimmed.match(/^at:\/\/[^/]+\/space\/[^/]+\/([^/]+)\/?$/);

    return match?.[1] ?? "";
  }

  return trimmed.replace(/^\/+|\/+$/g, "");
}

async function loadSpaces(): Promise<void> {
  if (!atproto.value || !atprotoStatus.value.signedIn || !atprotoStatus.value.syncing) {
    spaces.value = [];
    return;
  }

  spacesLoading.value = true;
  spacesError.value = "";
  try {
    spaces.value = await atproto.value.listWorkspaceSpaces(
      new Set(workspaces.value.map((entry) => entry.id)),
    );
  } catch (cause) {
    spacesError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    spacesLoading.value = false;
  }
}

async function openSpace(id: string): Promise<void> {
  if (!id || joining.value || accountBusy.value) return;
  joining.value = true;
  spacesError.value = "";
  try {
    if (!spaces.value.some((space) => space.id === id)) {
      const exists = await atproto.value?.workspaceSpaceExists(id);
      if (!exists) {
        spacesError.value = t("settings.syncJoinNotFound");

        return;
      }
    }
    await joinWorkspace(id, workspaceName(id) || t("settings.syncSharedWorkspace"));
    settingsDialog.hide();
  } catch (cause) {
    spacesError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    joining.value = false;
  }
}

async function onJoin(): Promise<void> {
  const id = parseSpaceId(joinInput.value);
  if (!id) {
    spacesError.value = t("settings.syncJoinInvalid");

    return;
  }
  await openSpace(id);
}

async function copySpace(): Promise<void> {
  if (!spaceUri.value || accountBusy.value) return;
  await navigator.clipboard.writeText(spaceUri.value);
  pushToast({ titleKey: "common.copied", duration: 1800 });
}

onMounted(loadSpaces);
watch(
  () => [atprotoStatus.value.signedIn, atprotoStatus.value.syncing, spaceUri.value],
  () => void loadSpaces(),
);
</script>

<template>
  <div class="sync">
    <!-- <h4 class="sync__heading">{{ $t("settings.tabSync") }}</h4> -->

    <template v-if="atprotoReady && atproto">
      <template v-if="!atprotoStatus.signedIn">
        <p class="sync__hint">{{ $t("settings.syncSignInHint") }}</p>

        <p v-if="atprotoStatus.error" class="sync__hint sync__hint--error" role="alert">
          {{ atprotoStatus.error }}
        </p>

        <AtprotoSignIn />

        <p class="sync__note">
          <MsIcon name="info" :size="18" />
          <span>
            {{ $t("settings.syncAlpha") }}
            <a
              class="sync__link"
              :href="SPACES_ALPHA_URL"
              rel="noopener noreferrer"
              @click.prevent="openExternal(SPACES_ALPHA_URL)"
            >
              {{ $t("settings.syncLearnMore") }}
            </a>
          </span>
        </p>
      </template>

      <template v-else>
        <div class="sync__account">
          <img v-if="activeAvatar" class="sync__avatar" :src="activeAvatar" alt="" />
          <MsIcon
            v-else
            class="sync__avatar sync__avatar--placeholder"
            name="account_circle"
            :size="44"
          />
          <div class="sync__account-info">
            <span class="sync__account-name">{{ profileName }}</span>
            <span v-if="activeHandle" class="sync__handle">@{{ activeHandle }}</span>
            <span class="sync__did">{{ atprotoStatus.did }}</span>
          </div>
        </div>

        <p v-if="profile?.description" class="sync__bio">{{ profile.description }}</p>

        <!-- <UiButton
          v-if="atprotoStatus.did"
          class="sync__profile"
          icon="open_in_new"
          @click="emit('open-profile', atprotoStatus.did)"
        >
          {{ $t("settings.viewProfile") }}
        </UiButton> -->

        <div class="sync__accounts">
          <div class="sync__accounts-head">
            <p class="sync__label">{{ $t("settings.accountsTitle") }}</p>
            <UiButton
              variant="plain"
              :icon="addAccountOpen ? 'close' : 'add'"
              :disabled="accountBusy || !atprotoReady"
              @click="toggleAddAccount"
            >
              {{ addAccountOpen ? $t("common.cancel") : $t("settings.accountAdd") }}
            </UiButton>
          </div>

          <p v-if="otherAccounts.length" class="sync__hint">
            {{ $t("settings.accountSwitchHint") }}
          </p>

          <ul v-if="otherAccounts.length" class="sync__account-list">
            <li v-for="account in otherAccounts" :key="account.did" class="sync__account-row">
              <img
                v-if="account.avatar"
                class="sync__account-avatar"
                :src="account.avatar"
                alt=""
              />
              <MsIcon
                v-else
                class="sync__account-avatar sync__account-avatar--placeholder"
                name="account_circle"
                :size="32"
              />
              <div class="sync__account-copy">
                <span class="sync__account-row-name">{{ accountName(account) }}</span>
                <span v-if="account.displayName || account.handle" class="sync__account-row-meta">
                  <span v-if="account.displayName && account.handle" class="sync__handle">
                    @{{ account.handle }}
                  </span>
                  <span class="sync__did">{{ shortDid(account.did) }}</span>
                </span>
              </div>
              <div class="sync__account-actions">
                <UiButton
                  variant="plain"
                  size="large"
                  :aria-label="`${$t('settings.accountSwitch')} ${accountName(account)}`"
                  :disabled="accountBusy"
                  @click="onSwitchAccount(account.did)"
                >
                  {{
                    switchBusy === account.did
                      ? $t("settings.accountSwitching")
                      : $t("settings.accountSwitch")
                  }}
                </UiButton>
                <UiIconButton
                  icon="person_remove"
                  variant="ghost"
                  danger
                  :size="18"
                  :label="`${$t('settings.accountRemove')} ${accountName(account)}`"
                  :disabled="accountBusy"
                  @click="askRemoveAccount(account)"
                />
              </div>
            </li>
          </ul>

          <p v-else-if="!addAccountOpen" class="sync__hint">
            {{ $t("settings.accountNone") }}
          </p>

          <AtprotoSignIn v-if="addAccountOpen" compact />

          <p v-if="accountError" class="sync__hint sync__hint--error" role="alert">
            {{ accountError }}
          </p>
        </div>

        <template v-if="atprotoStatus.syncing">
          <div
            class="sync__status"
            :class="{ 'sync__status--busy': exporting }"
            role="status"
            aria-live="polite"
          >
            <div class="sync__status-head">
              <span class="sync__status-dot" aria-hidden="true" />
              <span class="sync__status-label">{{ statusLabel }}</span>
              <span v-if="atprotoStatus.pendingUpdates" class="sync__status-count">
                {{ $t("settings.syncPendingCount", { count: atprotoStatus.pendingUpdates }) }}
              </span>
            </div>
            <div class="sync__status-meta">
              <span class="sync__status-meta-item">
                <MsIcon name="upload" :size="14" />
                {{ $t("settings.syncExported") }} {{ ago(atprotoStatus.lastExportAt) }}
              </span>
              <span class="sync__status-meta-item">
                <MsIcon name="download" :size="14" />
                {{ $t("settings.syncImported") }} {{ ago(atprotoStatus.lastImportAt) }}
              </span>
            </div>
          </div>
          <!-- <p class="sync__hint" :class="{ 'sync__hint--error': atprotoStatus.error }">
            {{ atprotoStatus.error ?? $t("settings.syncPlaintext") }}
          </p> -->

          <div v-if="atprotoStatus.members.length" class="sync__members">
            <p class="sync__hint">{{ $t("settings.syncMembers") }}</p>
            <ul>
              <li v-for="member in atprotoStatus.members" :key="member.did">
                {{ shortDid(member.did) }}
              </li>
            </ul>
          </div>

          <div class="sync__space">
            <div class="sync__space-head">
              <p class="sync__label">{{ $t("settings.syncSpace") }}</p>
              <UiButton
                v-if="spaceUri"
                variant="plain"
                icon="content_copy"
                :disabled="accountBusy"
                @click="copySpace"
              >
                {{ $t("settings.syncCopySpace") }}
              </UiButton>
            </div>
            <p class="sync__hint">{{ $t("settings.syncSpaceHint") }}</p>
            <code v-if="spaceUri" class="sync__space-uri">{{ spaceUri }}</code>

            <form class="sync__join-form" @submit.prevent="onJoin">
              <UiTextField
                v-model="joinInput"
                :label="$t('settings.syncJoinTitle')"
                :placeholder="$t('settings.syncJoinPlaceholder')"
                autocapitalize="none"
                spellcheck="false"
                :disabled="joining || accountBusy"
              />
              <UiButton
                type="submit"
                size="large"
                :disabled="joining || accountBusy || !joinInput.trim()"
              >
                {{ $t("settings.syncJoin") }}
              </UiButton>
            </form>
            <p class="sync__hint">{{ $t("settings.syncJoinHint") }}</p>

            <p class="sync__label">{{ $t("settings.syncSpaces") }}</p>
            <p v-if="spacesLoading" class="sync__hint">{{ $t("settings.syncSpacesLoading") }}</p>
            <ul v-else-if="spaces.length" class="sync__spaces">
              <li
                v-for="space in spaces"
                :key="space.id"
                class="sync__space-item"
                :class="{ 'sync__space-item--current': isCurrentSpace(space.id) }"
              >
                <span class="sync__space-main">
                  <span class="sync__space-icon" :style="spaceStyle(space.id)" aria-hidden="true">
                    <MsIcon :name="spaceIcon(space.id)" :size="22" />
                  </span>
                  <span class="sync__space-copy">
                    <span class="sync__space-name">{{ spaceLabel(space) }}</span>
                    <span class="sync__space-meta">
                      <span class="sync__space-id">{{ space.id }}</span>
                      <span v-if="isCurrentSpace(space.id)" class="sync__space-current">
                        <MsIcon name="check" :size="13" />
                        {{ $t("settings.syncCurrent") }}
                      </span>
                    </span>
                  </span>
                </span>
                <UiButton
                  v-if="!isCurrentSpace(space.id)"
                  variant="plain"
                  :disabled="joining || accountBusy"
                  @click="openSpace(space.id)"
                >
                  {{ workspaceName(space.id) ? $t("settings.syncOpen") : $t("settings.syncJoin") }}
                </UiButton>
              </li>
            </ul>
            <p v-else class="sync__hint">{{ $t("settings.syncNoSpaces") }}</p>
            <p v-if="spacesError" class="sync__hint sync__hint--error">{{ spacesError }}</p>
          </div>
        </template>

        <!-- Signed in, but the PDS never attached the space (Spaces alpha, or
             setup failed). Say what works instead of showing an "in sync"
             status that would be false. -->
        <p v-else class="sync__warning">
          <MsIcon name="warning" :size="18" />
          <span>
            {{ atprotoStatus.error ?? $t("settings.syncOff") }}
            <template v-if="spacesUnsupported">
              <a
                class="sync__link"
                :href="SPACES_ALPHA_URL"
                rel="noopener noreferrer"
                @click.prevent="openExternal(SPACES_ALPHA_URL)"
              >
                {{ $t("settings.syncLearnMore") }}
              </a>
            </template>
          </span>
        </p>

        <div class="sync__footer">
          <UiButton
            variant="danger"
            icon="logout"
            :disabled="!atprotoReady || accountBusy"
            @click="onSignOut"
          >
            {{ signingOut ? $t("settings.syncSigningOut") : $t("settings.syncSignOut") }}
          </UiButton>
        </div>
      </template>
    </template>

    <p v-else class="sync__hint">{{ $t("settings.syncRequiresServer") }}</p>
  </div>

  <UiConfirmDialog
    :open="removeOpen"
    :title="$t('settings.accountRemoveTitle')"
    :description="
      $t('settings.accountRemoveConfirm', { name: removeTarget ? accountName(removeTarget) : '' })
    "
    :confirm-label="$t('settings.accountRemove')"
    @update:open="(value) => !value && (removeOpen = false)"
    @confirm="confirmRemoveAccount"
  />
</template>

<style>
.sync {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sync__heading {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.sync__account {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.sync__avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
}

.sync__avatar--placeholder {
  color: var(--color-text-secondary);
}

.sync__account-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sync__account-name {
  overflow: hidden;
  font-size: var(--text-md);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync__handle {
  color: var(--color-accent);
  font-size: var(--text-sm);
}

.sync__did {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.sync__bio {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.sync__profile {
  align-self: flex-start;
}

.sync__accounts {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.sync__accounts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.sync__account-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sync__account-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.sync__account-avatar {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.sync__account-avatar--placeholder {
  color: var(--color-text-secondary);
}

.sync__account-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sync__account-row-name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync__account-row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.sync__account-row-meta .sync__handle {
  flex: none;
  font-size: var(--text-xs);
}

.sync__account-row-meta .sync__did {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync__account-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

.sync__hint {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.sync__hint--error {
  color: var(--color-danger);
}

.sync__status {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2) var(--space-2-5);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sync__status-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sync__status-dot {
  flex: none;
  width: 8px;
  height: 8px;
  background: var(--color-ok);
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--color-ok-soft);
}

.sync__status--busy .sync__status-dot {
  background: var(--color-warning);
  box-shadow: 0 0 0 3px var(--color-warning-soft);
}

.sync__status-label {
  font-size: var(--text-sm);
  font-weight: 600;
}

.sync__status-count {
  margin-left: auto;
  padding: 1px var(--space-1-5);
  color: var(--color-warning);
  font-size: var(--text-xs);
  background: var(--color-warning-soft);
  border-radius: 999px;
}

.sync__status-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.sync__status-meta-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
}

.sync__label {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 550;
}

.sync__space {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.sync__space-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.sync__space-uri {
  display: block;
  padding: var(--space-1-5) var(--space-2);
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.sync__join-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sync__join-form .ui-text-field {
  flex: 1;
  min-width: 0;
}

.sync__spaces {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sync__space-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: var(--control-sm);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.sync__space-item--current {
  background: var(--color-accent-soft);
}

.sync__space-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
}

.sync__space-icon {
  display: grid;
  flex: none;
  place-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  color: var(--ws-accent, var(--color-accent));
  background: color-mix(in srgb, var(--ws-accent, var(--color-accent)) 16%, transparent);
  border-radius: var(--radius-sm);
}

.sync__space-item--current .sync__space-icon {
  background: var(--color-surface);
}

.sync__space-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sync__space-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync__space-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
}

.sync__space-id {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
}

.sync__space-current {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  color: var(--color-accent);
  font-size: var(--text-2xs);
  white-space: nowrap;
}

.sync__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.sync__warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-radius: var(--radius-sm);
  overflow-wrap: anywhere;
}

.sync__warning .ms-icon {
  flex: none;
  margin-top: 0.1rem;
}

/* The Spaces alpha caveat, quieter than the sign-in copy. */
.sync__note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.sync__note .ms-icon {
  flex: none;
  margin-top: 0.1rem;
  color: var(--color-accent);
}

.sync__link {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.sync__ok {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-ok);
}

.sync__members ul {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
