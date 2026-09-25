<script setup lang="ts">
import { formatAgo } from "~/lib/format";
import { openExternal } from "~/lib/openExternal";

const { t, locale } = useI18n();
const { atproto, atprotoStatus, atprotoReady } = useWorkspace();

/**
 * Sign-in runs through the PDS's OAuth flow, which has no account creation
 * step, so people who arrive without an account get pointed at one. Bluesky
 * is the account most atproto newcomers already have; the protocol itself
 * works with any PDS.
 */
const CREATE_ACCOUNT_URL = "https://bsky.app/";
const SPACES_ALPHA_URL = "https://atproto.com/blog/atproto-spaces-alpha";

const identifier = ref("");
const busy = ref(false);
const error = ref("");
/** The last failure was an unresolvable handle; offer account creation. */
const unknownHandle = ref(false);

// Web sign-in redirects the page away, so the promise never settles; native
// opens the system browser and waits on a deep link. Clear the busy flag
// either way so someone who comes back without a session can retry.
const { start: resetBusy } = useTimeoutFn(
  () => {
    busy.value = false;
  },
  10_000,
  { immediate: false },
);

/** Handles are written "name.host"; the OAuth client takes the bare handle or a DID. */
function normalizeIdentifier(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("did:")) return value;

  const handle = value.replace(/^@/, "");
  const at = handle.indexOf("@");

  return at > 0 ? `${handle.slice(0, at)}.${handle.slice(at + 1)}` : handle;
}

async function onSignIn() {
  if (busy.value || !atproto.value) return;

  const handle = normalizeIdentifier(identifier.value);
  if (!handle) return;

  busy.value = true;
  error.value = "";
  unknownHandle.value = false;
  resetBusy();
  try {
    await atproto.value.signIn(handle);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    unknownHandle.value = /handle|resolve/i.test(message);
    error.value = unknownHandle.value
      ? t("settings.syncUnknownHandle", { identifier: handle })
      : message;
  } finally {
    busy.value = false;
  }
}

async function onSignOut() {
  await atproto.value?.signOut();
}

/** DIDs are long; show the method prefix and the tail. */
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
    <h4 class="sync__heading">{{ $t("settings.tabSync") }}</h4>

    <template v-if="atprotoReady && atproto">
      <template v-if="!atprotoStatus.signedIn">
        <p class="sync__hint">{{ $t("settings.syncSignInHint") }}</p>

        <form class="sync__signin" @submit.prevent="onSignIn">
          <label class="sync__label" for="sync-identifier">{{ $t("settings.syncAccount") }}</label>
          <div class="sync__row">
            <UiTextField
              id="sync-identifier"
              v-model="identifier"
              class="sync__input"
              :placeholder="$t('settings.syncSignInPlaceholder')"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              :disabled="busy"
            />
            <UiButton type="submit" variant="primary" :disabled="busy || !identifier.trim()">
              <span v-if="busy" class="sync__spinner" aria-hidden="true" />
              {{ busy ? $t("settings.syncSignInBusy") : $t("settings.syncSignIn") }}
            </UiButton>
          </div>
        </form>

        <div v-if="error" class="sync__error" role="alert">
          <MsIcon name="error" :size="16" />
          <span class="sync__error-body">
            <span>{{ error }}</span>
            <a
              v-if="unknownHandle"
              class="sync__link"
              :href="CREATE_ACCOUNT_URL"
              rel="noopener noreferrer"
              @click.prevent="openExternal(CREATE_ACCOUNT_URL)"
            >
              {{ $t("settings.syncCreateAccount") }}
            </a>
          </span>
        </div>

        <p class="sync__hint">
          {{ $t("settings.syncNewHere") }}
          <a
            class="sync__link"
            :href="CREATE_ACCOUNT_URL"
            rel="noopener noreferrer"
            @click.prevent="openExternal(CREATE_ACCOUNT_URL)"
          >
            {{ $t("settings.syncCreateAccount") }}
          </a>
        </p>
        <!-- <p class="sync__hint">{{ $t("settings.syncNewHereHint") }}</p> -->

        <p class="sync__note">
          <MsIcon name="info" :size="16" />
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
        <p class="sync__ok">
          <MsIcon name="check_circle" :size="16" />
          {{ $t("settings.signedInAs", { did: shortDid(atprotoStatus.did) }) }}
        </p>

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
          <MsIcon name="warning" :size="16" />
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

.sync__hint {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.sync__hint--error {
  color: var(--color-danger);
}

.sync__signin {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sync__label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.sync__row {
  display: flex;
  gap: var(--space-2);
}

.sync__input {
  flex: 1;
  min-width: 0;
}

.sync__spinner {
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: sync-spin 0.7s linear infinite;
}

@keyframes sync-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Failures carry the message plus a way forward (account creation). */
.sync__error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
  overflow-wrap: anywhere;
}

.sync__error .ms-icon {
  flex: none;
  margin-top: 0.1rem;
}

.sync__error-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
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
  padding-left: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
