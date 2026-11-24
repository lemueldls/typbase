<script setup lang="ts">
import type { WorkspaceSpaceRef, WorkspaceSpaceRole } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import {
  parseWorkspaceInvite,
  parseWorkspaceSpaceRef,
  workspaceInviteUri,
  workspaceSpaceRef,
} from "@typbase/spaces";

import type { ActorSuggestion, PublicProfile } from "~/lib/actor";
import type { AtprotoStatus, WorkspaceSpaceSummary } from "~/lib/atproto";

import ActorTypeahead from "~/components/account/ActorTypeahead.vue";
import SyncStatus from "~/components/account/SyncStatus.vue";
import SettingsSection from "~/components/settings/SettingsSection.vue";
import { normalizeAccountHandle, shortDid } from "~/lib/accountHandle";
import { fetchPublicProfile, resolveActorDid } from "~/lib/actor";
import { openExternal } from "~/lib/openExternal";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

type Member = AtprotoStatus["members"][number];

/**
 * Sync status and Spaces. Account sign-in, switching, and the data label live
 * in the shared account dialog so every surface uses one account flow.
 */
const { t } = useI18n();
const { atproto, atprotoStatus, atprotoReady, joinWorkspace, workspaceId, workspaces } =
  useWorkspace();
const settingsDialog = useSettingsDialog();
const accountDialog = useAccountDialog();

const SPACES_ALPHA_URL = "https://atproto.com/blog/atproto-spaces-alpha";

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

/** Account switching lives in the account dialog, so the panel only needs readiness. */
const accountBusy = computed(() => !atprotoReady.value);

/** The service names Spaces when the PDS cannot host the workspace space. */
const spacesUnsupported = computed(() => /spaces/i.test(atprotoStatus.value.error ?? ""));

const spaceUri = computed(() => atprotoStatus.value.spaceUri);
const isOwner = computed(() => atprotoStatus.value.spaceRole === "owner");
const readOnly = computed(() => atprotoStatus.value.readOnly);
const sharedRole = computed(() => {
  const role = atprotoStatus.value.spaceRole;

  return role === "editor" || role === "viewer" ? role : null;
});
const roleLabel = computed(() => {
  if (sharedRole.value === "editor") return t("settings.syncEditor");
  if (sharedRole.value === "viewer") return t("settings.syncViewer");

  return "";
});

function workspaceName(id: string): string {
  return workspaces.value.find((entry) => entry.id === id || entry.space?.skey === id)?.name ?? "";
}

function spaceLabel(space: WorkspaceSpaceSummary): string {
  return (
    workspaceName(space.id) || space.name || `${t("settings.syncSharedWorkspace")} ${space.id}`
  );
}

function isCurrentSpace(space: WorkspaceSpaceSummary): boolean {
  return space.uri === spaceUri.value || space.id === workspaceId.value;
}

function localSpace(space: WorkspaceSpaceSummary) {
  return workspaces.value.find((entry) => entry.space?.uri === space.uri || entry.id === space.id);
}

function spaceIcon(space: WorkspaceSpaceSummary): MaterialSymbol {
  const icon = localSpace(space)?.icon;

  return (icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
}

function spaceStyle(space: WorkspaceSpaceSummary): Record<string, string> | undefined {
  const accent = localSpace(space)?.accent;

  return accent ? { "--ws-accent": accent } : undefined;
}

const spaces = ref<WorkspaceSpaceSummary[]>([]);
const spacesLoading = ref(false);
const spacesLoaded = ref(false);
const spacesError = ref("");
let spacesSequence = 0;

async function loadSpaces(): Promise<void> {
  const client = atproto.value;
  if (!client || !atprotoStatus.value.signedIn) {
    spaces.value = [];
    spacesLoaded.value = false;
    spacesLoading.value = false;
    spacesError.value = "";

    return;
  }

  const sequence = ++spacesSequence;
  const firstLoad = !spacesLoaded.value;
  if (firstLoad) spacesLoading.value = true;
  spacesError.value = "";
  try {
    const next = await client.listWorkspaceSpaces(
      new Set(workspaces.value.map((entry) => (entry.space ? entry.space.skey : entry.id))),
    );
    if (sequence !== spacesSequence) return;
    spaces.value = next;
  } catch (cause) {
    if (sequence !== spacesSequence) return;
    spacesError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (sequence === spacesSequence) {
      spacesLoading.value = false;
      spacesLoaded.value = true;
    }
  }
}

// Keep the loaded rows on screen while a refresh runs. Only an account change
// clears them, so the panel does not collapse and grow on every sync tick.
watch(
  () => [atproto.value, atprotoStatus.value.signedIn, atprotoStatus.value.did] as const,
  (current, previous) => {
    const [client, signedIn, did] = current;
    if (!client || !signedIn) {
      spacesSequence++;
      spaces.value = [];
      spacesLoaded.value = false;
      spacesLoading.value = false;
      spacesError.value = "";

      return;
    }
    if (previous && previous[0] === client && previous[1] === signedIn && previous[2] === did) {
      return;
    }
    spacesSequence++;
    spaces.value = [];
    spacesLoaded.value = false;
    spacesLoading.value = false;
    spacesError.value = "";
    void loadSpaces();
  },
  { immediate: true },
);

const joinInput = ref("");
const joining = ref(false);

async function openRef(
  ref: WorkspaceSpaceRef,
  role: WorkspaceSpaceRole,
  name: string,
): Promise<void> {
  if (!atproto.value || joining.value || accountBusy.value) return;
  joining.value = true;
  spacesError.value = "";
  try {
    const known = workspaces.value.some(
      (entry) =>
        entry.space?.uri === ref.uri ||
        (!entry.space && entry.id === ref.skey && ref.ownerDid === atprotoStatus.value.did),
    );
    if (!known && !(await atproto.value.workspaceSpaceExists(ref))) {
      spacesError.value = t("settings.syncJoinNotFound");

      return;
    }
    await joinWorkspace(ref, role, name);
    settingsDialog.hide();
  } catch (cause) {
    spacesError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    joining.value = false;
  }
}

async function openSpace(space: WorkspaceSpaceSummary): Promise<void> {
  const did = atprotoStatus.value.did;
  if (!did) return;

  const role = localSpace(space)?.spaceRole ?? "owner";
  await openRef(workspaceSpaceRef(did, space.id), role, spaceLabel(space));
}

async function onJoin(): Promise<void> {
  const value = joinInput.value.trim();
  const invite = parseWorkspaceInvite(value);
  if (invite) {
    const role: WorkspaceSpaceRole =
      invite.ownerDid === atprotoStatus.value.did ? "owner" : invite.role;
    await openRef(invite, role, t("settings.syncSharedWorkspace"));

    return;
  }

  const did = atprotoStatus.value.did;
  const id = value.replace(/^\/+|\/+$/g, "");
  if (!did || !id || id.includes("/")) {
    spacesError.value = t("settings.syncJoinInvalid");

    return;
  }
  await openRef(
    workspaceSpaceRef(did, id),
    "owner",
    workspaceName(id) || t("settings.syncSharedWorkspace"),
  );
}

const memberQuery = ref("");
const memberDid = ref("");
const memberSelection = ref<ActorSuggestion | null>(null);
const memberRole = ref<"editor" | "viewer">("viewer");
const memberBusy = ref(false);
const sharingError = ref("");
const inviteCopied = ref<string | null>(null);
const memberProfiles = ref<Record<string, PublicProfile | null>>({});
const memberProfilesLoading = new Set<string>();
const memberRoleOptions = computed(() => [
  { value: "editor", label: t("settings.syncEditor") },
  { value: "viewer", label: t("settings.syncViewer") },
]);
let inviteTimer: ReturnType<typeof setTimeout> | undefined;

async function loadMemberProfiles(): Promise<void> {
  await Promise.all(
    atprotoStatus.value.members.map(async (member) => {
      if (member.did in memberProfiles.value || memberProfilesLoading.has(member.did)) return;

      memberProfilesLoading.add(member.did);
      const resolved = await fetchPublicProfile(member.did);
      memberProfilesLoading.delete(member.did);
      memberProfiles.value = { ...memberProfiles.value, [member.did]: resolved };
    }),
  );
}

watch(
  () => atprotoStatus.value.members.map((member) => member.did).join("|"),
  () => void loadMemberProfiles(),
  { immediate: true },
);

function memberProfile(member: Member): PublicProfile | null {
  return memberProfiles.value[member.did] ?? null;
}

function memberName(member: Member): string {
  const resolved = memberProfiles.value[member.did];

  return resolved?.displayName || member.handle || resolved?.handle || shortDid(member.did);
}

function memberHandle(member: Member): string | null {
  return member.handle ?? memberProfiles.value[member.did]?.handle ?? null;
}

watch(memberQuery, (value) => {
  if (memberSelection.value && value !== memberSelection.value.handle) {
    memberSelection.value = null;
    memberDid.value = "";
  }
});

function pickMember(suggestion: ActorSuggestion): void {
  memberSelection.value = suggestion;
  memberDid.value = suggestion.did;
}

async function addMember(): Promise<void> {
  const client = atproto.value;
  const query = memberQuery.value.trim();
  if (!client || memberBusy.value || !query) return;

  memberBusy.value = true;
  sharingError.value = "";
  try {
    const did = memberDid.value.trim() || (await resolveActorDid(normalizeAccountHandle(query)));
    if (!did) {
      sharingError.value = t("settings.syncUnknownHandle", { identifier: query });

      return;
    }
    await client.putMember(did, { read: true, write: memberRole.value === "editor" });
    memberQuery.value = "";
    memberSelection.value = null;
    memberDid.value = "";
  } catch (cause) {
    sharingError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    memberBusy.value = false;
  }
}

async function removeMember(did: string): Promise<void> {
  if (!atproto.value) return;
  memberBusy.value = true;
  sharingError.value = "";
  try {
    await atproto.value.removeMember(did);
  } catch (cause) {
    sharingError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    memberBusy.value = false;
  }
}

async function setMemberRole(did: string, role: string): Promise<void> {
  const client = atproto.value;
  if (!client || memberBusy.value) return;

  const member = atprotoStatus.value.members.find((entry) => entry.did === did);
  const write = role === "editor";
  if (!member || member.write === write) return;

  memberBusy.value = true;
  sharingError.value = "";
  try {
    await client.putMember(did, { read: true, write });
  } catch (cause) {
    sharingError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    memberBusy.value = false;
  }
}

async function copyMemberLink(member: Member): Promise<void> {
  const ref = spaceUri.value ? parseWorkspaceSpaceRef(spaceUri.value) : null;
  if (!ref) return;

  const role = member.write ? "editor" : "viewer";
  try {
    await navigator.clipboard.writeText(workspaceInviteUri(ref, role));
  } catch (cause) {
    sharingError.value = cause instanceof Error ? cause.message : String(cause);

    return;
  }
  clearTimeout(inviteTimer);
  inviteCopied.value = member.did;
  inviteTimer = setTimeout(() => {
    if (inviteCopied.value === member.did) inviteCopied.value = null;
  }, 1600);
}

onBeforeUnmount(() => clearTimeout(inviteTimer));
</script>

<template>
  <div class="sync">
    <template v-if="atprotoReady && atproto">
      <SettingsSection v-if="!atprotoStatus.signedIn" :title="$t('settings.tabSync')">
        <div class="sync__body">
          <p class="sync__hint">{{ $t("settings.syncSignInHint") }}</p>

          <p v-if="atprotoStatus.error" class="sync__hint sync__hint--error" role="alert">
            {{ atprotoStatus.error }}
          </p>

          <UiButton variant="primary" size="large" @click="accountDialog.show('signin')">
            {{ $t("account.signIn") }}
          </UiButton>

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
        </div>
      </SettingsSection>

      <template v-else>
        <SettingsSection :title="$t('settings.syncAccount')" anchor="sync-account">
          <div class="sync__body">
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
              <UiIconButton
                class="sync__manage"
                icon="manage_accounts"
                :size="20"
                :label="$t('account.manage')"
                :disabled="!atprotoReady"
                @click="accountDialog.show('accounts')"
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection :title="$t('settings.syncStatusTitle')" anchor="sync-status">
          <div class="sync__body">
            <SyncStatus />

            <p v-if="spacesUnsupported" class="sync__hint">
              {{ $t("settings.syncAlpha") }}
              <a
                class="sync__link"
                :href="SPACES_ALPHA_URL"
                rel="noopener noreferrer"
                @click.prevent="openExternal(SPACES_ALPHA_URL)"
              >
                {{ $t("settings.syncLearnMore") }}
              </a>
            </p>
          </div>
        </SettingsSection>

        <SettingsSection
          v-if="atprotoStatus.syncing && (isOwner || atprotoStatus.spaceRole)"
          :title="$t('settings.syncSharing')"
          anchor="sync-sharing"
        >
          <div class="sync__body">
            <template v-if="isOwner">
              <p class="sync__hint">{{ $t("settings.syncPlaintext") }}</p>

              <div class="sync__block">
                <div class="sync__block-head">
                  <p class="sync__label">{{ $t("settings.syncMembers") }}</p>
                  <UiBadge v-if="atprotoStatus.members.length">
                    {{ atprotoStatus.members.length }}
                  </UiBadge>
                </div>

                <ul v-if="atprotoStatus.members.length" class="sync__members">
                  <li
                    v-for="member in atprotoStatus.members"
                    :key="member.did"
                    class="sync__member"
                  >
                    <img
                      v-if="memberProfile(member)?.avatar"
                      class="sync__member-avatar"
                      :src="memberProfile(member)?.avatar ?? ''"
                      alt=""
                    />
                    <MsIcon
                      v-else
                      class="sync__member-avatar sync__member-avatar--placeholder"
                      name="account_circle"
                      :size="32"
                    />
                    <span class="sync__member-copy">
                      <span class="sync__member-name">{{ memberName(member) }}</span>
                      <span class="sync__member-meta">
                        <span v-if="memberHandle(member)" class="sync__member-handle">
                          @{{ memberHandle(member) }}
                        </span>
                        <span class="sync__member-did">{{ shortDid(member.did) }}</span>
                      </span>
                    </span>
                    <UiSelect
                      class="sync__member-role"
                      :model-value="member.write ? 'editor' : 'viewer'"
                      :label="`${$t('settings.syncRole')}: ${memberName(member)}`"
                      :options="memberRoleOptions"
                      :disabled="memberBusy"
                      @update:model-value="(role) => setMemberRole(member.did, role)"
                    />
                    <UiIconButton
                      :icon="inviteCopied === member.did ? 'check' : 'link'"
                      :size="16"
                      :label="
                        inviteCopied === member.did
                          ? $t('settings.syncInviteCopied')
                          : $t('settings.syncCopyInvite')
                      "
                      :disabled="memberBusy"
                      @click="copyMemberLink(member)"
                    />
                    <UiIconButton
                      icon="person_remove"
                      :size="16"
                      :label="$t('settings.syncRemoveMember')"
                      :disabled="memberBusy"
                      @click="removeMember(member.did)"
                    />
                  </li>
                </ul>
                <p v-else class="sync__hint">{{ $t("settings.syncNoMembers") }}</p>
              </div>

              <div class="sync__block">
                <p class="sync__label">{{ $t("settings.syncAddMember") }}</p>

                <form class="sync__member-form" @submit.prevent="addMember">
                  <ActorTypeahead
                    v-model="memberQuery"
                    icon="person_search"
                    :label="$t('settings.syncAddMember')"
                    :placeholder="$t('settings.syncMemberPlaceholder')"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="memberBusy"
                    @select="pickMember"
                  />
                  <UiSelect
                    v-model="memberRole"
                    :label="$t('settings.syncRole')"
                    :options="memberRoleOptions"
                  />
                  <UiButton type="submit" :disabled="memberBusy || !memberQuery.trim()">
                    {{ $t("settings.syncAddMemberAction") }}
                  </UiButton>
                </form>
                <p class="sync__hint">{{ $t("settings.syncAddMemberHint") }}</p>
              </div>

              <!-- <div class="sync__block">
                <p class="sync__label">{{ $t("settings.syncInviteTitle") }}</p>
                <p class="sync__hint">{{ $t("settings.syncInviteHint") }}</p>
              </div> -->

              <p v-if="sharingError" class="sync__hint sync__hint--error" role="alert">
                {{ sharingError }}
              </p>
            </template>

            <template v-else>
              <p class="sync__hint">
                {{ $t("settings.syncRoleHint", { role: atprotoStatus.spaceRole }) }}
              </p>
              <p v-if="readOnly" class="sync__warning">
                <MsIcon name="lock" :size="18" />
                <span>{{ $t("settings.syncReadOnly") }}</span>
              </p>
            </template>
          </div>
        </SettingsSection>

        <SettingsSection :title="$t('settings.syncSpacesTitle')" anchor="sync-spaces">
          <div class="sync__body">
            <div v-if="spaceUri" class="sync__block">
              <div class="sync__block-head">
                <p class="sync__label">{{ $t("settings.syncSpace") }}</p>
                <UiBadge v-if="roleLabel" tone="accent">{{ roleLabel }}</UiBadge>
              </div>
              <p class="sync__hint">{{ $t("settings.syncSpaceHint") }}</p>
              <UiCodeBlock :text="spaceUri" :label="$t('settings.syncCopySpace')" truncate />
            </div>

            <div class="sync__block">
              <p class="sync__label">{{ $t("settings.syncJoinTitle") }}</p>
              <form class="sync__join-form" @submit.prevent="onJoin">
                <UiTextField
                  v-model="joinInput"
                  :label="$t('settings.syncJoinTitle')"
                  :placeholder="$t('settings.syncJoinPlaceholder')"
                  autocapitalize="none"
                  spellcheck="false"
                  :disabled="joining || accountBusy"
                />
                <UiButton type="submit" :disabled="joining || accountBusy || !joinInput.trim()">
                  {{ $t("settings.syncJoin") }}
                </UiButton>
              </form>
              <p class="sync__hint">{{ $t("settings.syncJoinHint") }}</p>
            </div>

            <div class="sync__block">
              <div class="sync__block-head">
                <p class="sync__label">{{ $t("settings.syncSpaces") }}</p>
                <UiBadge v-if="spaces.length">{{ spaces.length }}</UiBadge>
              </div>

              <ul v-if="spaces.length" class="sync__spaces">
                <li
                  v-for="space in spaces"
                  :key="space.uri"
                  class="sync__space-item"
                  :class="{ 'sync__space-item--current': isCurrentSpace(space) }"
                >
                  <span class="sync__space-main">
                    <span class="sync__space-icon" :style="spaceStyle(space)" aria-hidden="true">
                      <MsIcon :name="spaceIcon(space)" :size="22" />
                    </span>
                    <span class="sync__space-copy">
                      <span class="sync__space-name">{{ spaceLabel(space) }}</span>
                      <span class="sync__space-meta">
                        <span class="sync__space-id">{{ space.id }}</span>
                        <span v-if="isCurrentSpace(space)" class="sync__space-current">
                          <MsIcon name="check" :size="13" />
                          {{ $t("settings.syncCurrent") }}
                        </span>
                      </span>
                    </span>
                  </span>
                  <UiButton
                    v-if="!isCurrentSpace(space)"
                    variant="plain"
                    :disabled="joining || accountBusy"
                    @click="openSpace(space)"
                  >
                    {{
                      workspaceName(space.id) ? $t("settings.syncOpen") : $t("settings.syncJoin")
                    }}
                  </UiButton>
                </li>
              </ul>

              <ul v-else-if="spacesLoading" class="sync__spaces" aria-hidden="true">
                <li
                  v-for="placeholder in 2"
                  :key="placeholder"
                  class="sync__space-item sync__space-item--skeleton"
                >
                  <span class="sync__space-main">
                    <span class="sync__space-icon sync__skeleton sync__skeleton--icon" />
                    <span class="sync__space-copy">
                      <span class="sync__skeleton sync__skeleton--name" />
                      <span class="sync__skeleton sync__skeleton--id" />
                    </span>
                  </span>
                </li>
              </ul>

              <p v-else class="sync__hint">{{ $t("settings.syncNoSpaces") }}</p>
              <p v-if="spacesError" class="sync__hint sync__hint--error">{{ spacesError }}</p>
            </div>
          </div>
        </SettingsSection>
      </template>
    </template>

    <p v-else class="sync__hint">{{ $t("settings.syncRequiresServer") }}</p>
  </div>
</template>

<style>
.sync {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.sync__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
}

.sync__account {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.sync__manage {
  flex: none;
  margin-left: auto;
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

.sync__hint {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.sync__hint--error {
  color: var(--color-danger);
}

.sync__label {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 550;
}

.sync__block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sync__block + .sync__block {
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.sync__block-head {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
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
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.sync__space-item--current {
  background: var(--color-accent-soft);
  border-color: transparent;
}

.sync__space-item--skeleton {
  pointer-events: none;
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

.sync__skeleton {
  display: block;
  background: var(--color-surface-3);
  border-radius: var(--radius-xs);
  animation: sync-pulse 1.4s ease-in-out infinite;
}

.sync__skeleton--icon {
  width: var(--control-sm);
  height: var(--control-sm);
  border-radius: var(--radius-sm);
}

.sync__skeleton--name {
  width: 9rem;
  height: 0.7rem;
}

.sync__skeleton--id {
  width: 5rem;
  height: 0.55rem;
}

@keyframes sync-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
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
  background: var(--color-surface);
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

.sync__members {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sync__member {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
}

.sync__member:last-child {
  border-bottom: none;
}

.sync__member-avatar {
  flex: none;
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 50%;
}

.sync__member-avatar--placeholder {
  color: var(--color-text-tertiary);
}

.sync__member-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sync__member-name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync__member-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1px var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
}

.sync__member-handle {
  color: var(--color-accent);
  overflow-wrap: anywhere;
}

.sync__member-did {
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  overflow-wrap: anywhere;
}

.sync__member-role {
  flex: none;
  width: 7.5rem;
}

.sync__member-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8rem auto;
  align-items: center;
  gap: var(--space-2);
}

.sync__member-form .actor-typeahead {
  min-width: 0;
}

.sync__member-form .ui-select__trigger {
  width: 100%;
}

@media (max-width: 48rem) {
  .sync__member-form {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .sync__member-form .actor-typeahead {
    grid-column: 1 / -1;
  }
}

@media (max-width: 40rem) {
  .sync__member {
    flex-wrap: wrap;
  }

  .sync__member-copy {
    flex-basis: calc(100% - 2.5rem);
  }

  .sync__member-role {
    margin-left: calc(32px + var(--space-2));
  }
}

@media (prefers-reduced-motion: reduce) {
  .sync__skeleton {
    animation: none;
  }
}
</style>
