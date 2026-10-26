<script setup lang="ts">
import { openExternal } from "~/lib/openExternal";

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const { t } = useI18n();
const { atproto, atprotoReady } = useWorkspace();

const CREATE_ACCOUNT_URL = "https://bsky.app/";

const identifier = ref("");
const busy = ref(false);
const error = ref("");
/** The last failure was an unresolvable handle, so offer account creation. */
const unknownHandle = ref(false);

// Web sign-in redirects the page away, so the promise never settles. Native
// opens the system browser and waits on a deep link. Clear the busy flag
// either way so someone who comes back without a session can retry.
const { start: resetBusy } = useTimeoutFn(
  () => {
    busy.value = false;
  },
  10_000,
  { immediate: false },
);

/** Handles are written "name.host". The OAuth client takes the bare handle or a DID. */
function normalizeIdentifier(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("did:")) return value;

  const handle = value.replace(/^@/, "");
  const at = handle.indexOf("@");

  return at > 0 ? `${handle.slice(0, at)}.${handle.slice(at + 1)}` : handle;
}

async function onSignIn(): Promise<void> {
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
    // Only the resolution failures get the friendly account-not-found copy.
    // Anything else (a missing resolver, a network or CORS failure) shows the
    // real message so the cause is not hidden.
    unknownHandle.value =
      /does not resolve to a DID|does not include the handle|Invalid handle|Unable to resolve handle/i.test(
        message,
      );
    error.value = unknownHandle.value
      ? t("settings.syncUnknownHandle", { identifier: handle })
      : message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form
    class="atproto-signin"
    :class="{ 'atproto-signin--compact': compact }"
    @submit.prevent="onSignIn"
  >
    <label v-if="!compact" class="atproto-signin__label" for="atproto-signin-identifier">
      {{ $t("settings.syncAccount") }}
    </label>
    <div class="atproto-signin__row">
      <UiTextField
        id="atproto-signin-identifier"
        v-model="identifier"
        class="atproto-signin__input"
        :aria-label="$t('settings.syncAccount')"
        :placeholder="$t('settings.syncSignInPlaceholder')"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        :disabled="busy || !atprotoReady"
      />
      <UiButton
        type="submit"
        variant="primary"
        class="atproto-signin__button"
        size="large"
        :aria-label="busy ? $t('settings.syncSignInBusy') : $t('settings.syncSignIn')"
        :disabled="busy || !atprotoReady || !identifier.trim()"
      >
        <span class="atproto-signin__button-content">
          <span v-if="busy" class="atproto-signin__spinner" aria-hidden="true" />
          <span
            class="atproto-signin__button-label"
            :class="{ 'atproto-signin__label-hidden': busy }"
            :aria-hidden="busy"
          >
            {{ $t("settings.syncSignIn") }}
          </span>
        </span>
      </UiButton>
    </div>

    <div v-if="error" class="atproto-signin__error" role="alert">
      <MsIcon name="error" :size="18" />
      <span class="atproto-signin__error-body">
        <span>{{ error }}</span>
        <a
          v-if="unknownHandle"
          class="atproto-signin__link"
          :href="CREATE_ACCOUNT_URL"
          rel="noopener noreferrer"
          @click.prevent="openExternal(CREATE_ACCOUNT_URL)"
        >
          {{ $t("settings.syncCreateAccount") }}
        </a>
      </span>
    </div>

    <p v-if="!compact" class="atproto-signin__hint">
      {{ $t("settings.syncNewHere") }}
      <a
        class="atproto-signin__link"
        :href="CREATE_ACCOUNT_URL"
        rel="noopener noreferrer"
        @click.prevent="openExternal(CREATE_ACCOUNT_URL)"
      >
        {{ $t("settings.syncCreateAccount") }}
      </a>
    </p>
  </form>
</template>

<style>
.atproto-signin {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  min-width: 0;
}

.atproto-signin__label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.atproto-signin__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.atproto-signin__input {
  flex: 1;
  min-width: 0;
}

.atproto-signin__button-content {
  display: grid;
  place-items: center;
}

.atproto-signin__button-content > * {
  grid-area: 1 / 1;
}

.atproto-signin__spinner {
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: atproto-signin-spin 0.7s linear infinite;
}

.atproto-signin__label-hidden {
  visibility: hidden;
}

@keyframes atproto-signin-spin {
  to {
    transform: rotate(360deg);
  }
}

.atproto-signin__error {
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

.atproto-signin__error .ms-icon {
  flex: none;
  margin-top: 0.1rem;
}

.atproto-signin__error-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.atproto-signin__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.atproto-signin__link {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* @media (max-width: 30rem) {
  .atproto-signin__row {
    align-items: stretch;
    flex-direction: column;
  }
} */
</style>
