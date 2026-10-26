<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import type { WorkspaceSpaceSummary } from "~/lib/atproto";

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
const profileName = computed(
  () => profile.value?.displayName || profile.value?.handle || shortDid(atprotoStatus.value.did),
);

const SPACES_ALPHA_URL = "https://atproto.com/blog/atproto-spaces-alpha";

async function onSignOut() {
  await atproto.value?.signOut();
}

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
  if (!id || joining.value) return;
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
  if (!spaceUri.value) return;
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
          <img v-if="profile?.avatar" class="sync__avatar" :src="profile.avatar" alt="" />
          <MsIcon
            v-else
            class="sync__avatar sync__avatar--placeholder"
            name="account_circle"
            :size="44"
          />
          <div class="sync__account-info">
            <span class="sync__account-name">{{ profileName }}</span>
            <span v-if="profile?.handle" class="sync__handle">@{{ profile.handle }}</span>
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
              <UiButton v-if="spaceUri" variant="plain" icon="content_copy" @click="copySpace">
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
                :disabled="joining"
              />
              <UiButton type="submit" size="large" :disabled="joining || !joinInput.trim()">
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
                  <MsIcon class="sync__space-icon" :name="spaceIcon(space.id)" :size="18" />
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
                  size="tiny"
                  :disabled="joining"
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
          <UiButton variant="danger" icon="logout" :disabled="!atprotoReady" @click="onSignOut">
            {{ $t("settings.syncSignOut") }}
          </UiButton>
        </div>
      </template>
    </template>

    <p v-else class="sync__hint">{{ $t("settings.syncRequiresServer") }}</p>
  </div>
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
  padding: var(--space-1) var(--space-2);
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
  flex: none;
  color: var(--color-text-secondary);
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
