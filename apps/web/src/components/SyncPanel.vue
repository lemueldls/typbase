<script setup lang="ts">
import { formatAgo } from "~/lib/format";
import { openExternal } from "~/lib/openExternal";

/**
 * Sign-in and account details. The sign-in form is shared with the website
 * dashboard so both surfaces use the same handle normalization and errors.
 */
const { t, locale } = useI18n();
const { atproto, atprotoStatus, atprotoReady } = useWorkspace();

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

        <UiButton
          v-if="atprotoStatus.did"
          class="sync__profile"
          size="small"
          icon="open_in_new"
          @click="emit('open-profile', atprotoStatus.did)"
        >
          {{ $t("settings.viewProfile") }}
        </UiButton>

        <template v-if="atprotoStatus.syncing">
          <p class="sync__hint">
            {{
              $t("settings.syncStatus", {
                pending: atprotoStatus.pendingUpdates
                  ? $t("settings.syncExporting")
                  : $t("settings.syncInSync"),
                exported: ago(atprotoStatus.lastExportAt),
                imported: ago(atprotoStatus.lastImportAt),
              })
            }}
          </p>
          <p class="sync__hint" :class="{ 'sync__hint--error': atprotoStatus.error }">
            {{ atprotoStatus.error ?? $t("settings.syncPlaintext") }}
          </p>

          <div v-if="atprotoStatus.members.length" class="sync__members">
            <p class="sync__hint">{{ $t("settings.syncMembers") }}</p>
            <ul>
              <li v-for="member in atprotoStatus.members" :key="member.did">
                {{ shortDid(member.did) }}
              </li>
            </ul>
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

        <div>
          <UiButton :disabled="!atprotoReady" @click="onSignOut">
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
