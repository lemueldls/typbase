<script setup lang="ts">
import type { AccountView } from "~/composables/accountDialog";
import type { AccountHost } from "~/lib/accountHosts";
import type { ActorSuggestion } from "~/lib/actor";
import type { AtprotoAccount } from "~/lib/atproto";

import AccountDataLabel from "~/components/account/AccountDataLabel.vue";
import { pushToast } from "~/composables/toasts";
import { normalizeAccountHandle, shortDid } from "~/lib/accountHandle";
import {
  ACCOUNT_HOSTS,
  ACCOUNT_HOSTS_URL,
  ATMOSPHERE_APPS,
  defaultAccountHost,
} from "~/lib/accountHosts";
import { ACCOUNT_SCOPE_GROUPS } from "~/lib/accountScopes";
import { searchPublicActors } from "~/lib/actor";
import { openExternal } from "~/lib/openExternal";

const { t, locale } = useI18n();
const { open, view, hide } = useAccountDialog();
const { atproto, atprotoStatus, atprotoReady } = useWorkspace();

const identifier = ref("");
const busy = ref(false);
const error = ref("");
const unknownHandle = ref(false);
const suggestions = ref<ActorSuggestion[]>([]);
const suggestionsOpen = ref(false);
let searchSequence = 0;

const selectedHost = ref<AccountHost | null>(null);
const hostsOpen = ref(false);
const hostOpened = ref(false);

const switching = ref<string | null>(null);
const signingOut = ref(false);
const removing = ref(false);
const accountError = ref("");
const removeTarget = ref<AtprotoAccount | null>(null);
const installBusy = ref(false);
const previousView = ref<AccountView>("accounts");

const defaultHost = defaultAccountHost();
const otherHosts = computed(() => ACCOUNT_HOSTS.filter((host) => host.id !== defaultHost.id));
const appList = computed(() =>
  new Intl.ListFormat(locale.value, { style: "long", type: "conjunction" }).format([
    ...ATMOSPHERE_APPS,
  ]),
);

const activeAccount = computed(
  () =>
    atprotoStatus.value.accounts.find((account) => account.did === atprotoStatus.value.did) ?? null,
);
const otherAccounts = computed(() =>
  atprotoStatus.value.accounts.filter((account) => account.did !== atprotoStatus.value.did),
);
const activeName = computed(
  () =>
    atprotoStatus.value.profile?.displayName ||
    activeAccount.value?.displayName ||
    atprotoStatus.value.profile?.handle ||
    activeAccount.value?.handle ||
    shortDid(atprotoStatus.value.did),
);
const activeHandle = computed(
  () => atprotoStatus.value.profile?.handle ?? activeAccount.value?.handle ?? null,
);
const activeAvatar = computed(
  () => atprotoStatus.value.profile?.avatar ?? activeAccount.value?.avatar ?? null,
);

/** Accounts without a session belong on the sign-in view. */
const effectiveView = computed<AccountView>(() =>
  view.value === "accounts" && !atprotoStatus.value.signedIn ? "signin" : view.value,
);

const titles: Record<AccountView, string> = {
  signin: "account.titleSignIn",
  create: "account.titleCreate",
  permissions: "account.titlePermissions",
  accounts: "account.titleAccounts",
  data: "account.titleData",
};
const dialogTitle = computed(() => t(titles[effectiveView.value]));

const { start: resetBusy } = useTimeoutFn(
  () => {
    busy.value = false;
  },
  10_000,
  { immediate: false },
);

const runSearch = useDebounceFn(async (value: string) => {
  const sequence = ++searchSequence;
  const results = await searchPublicActors(value);
  if (sequence !== searchSequence) return;
  suggestions.value = results;
  suggestionsOpen.value = results.length > 0;
}, 180);

watch(identifier, (value) => {
  suggestions.value = [];
  suggestionsOpen.value = false;
  if (value.trim().length < 2 || value.trim().startsWith("did:")) return;
  void runSearch(value);
});

watch(
  () => atprotoStatus.value.did,
  (did) => {
    if (!did || !open.value) return;
    view.value = "accounts";
    resetSignIn();
  },
);

watch(open, (isOpen) => {
  if (isOpen) return;
  removeTarget.value = null;
  busy.value = false;
});

function resetSignIn(): void {
  identifier.value = "";
  error.value = "";
  unknownHandle.value = false;
  suggestions.value = [];
  suggestionsOpen.value = false;
  busy.value = false;
  accountError.value = "";
}

function openSignIn(): void {
  resetSignIn();
  view.value = "signin";
}

function backToSignIn(): void {
  view.value = "signin";
}

function openCreate(): void {
  selectedHost.value = null;
  hostsOpen.value = false;
  hostOpened.value = false;
  view.value = "create";
}

function openData(): void {
  if (view.value !== "data") previousView.value = view.value;
  view.value = "data";
}

function closeData(): void {
  view.value = previousView.value;
}

function startSignIn(): void {
  if (!atprotoReady.value) {
    error.value = t("account.notReady");

    return;
  }

  const handle = normalizeAccountHandle(identifier.value);
  if (!handle) return;

  identifier.value = handle;
  error.value = "";
  unknownHandle.value = false;
  suggestionsOpen.value = false;
  view.value = "permissions";
}

function pickSuggestion(suggestion: ActorSuggestion): void {
  identifier.value = suggestion.handle;
  startSignIn();
}

async function authorize(): Promise<void> {
  if (busy.value || !atproto.value) return;

  busy.value = true;
  error.value = "";
  unknownHandle.value = false;
  resetBusy();
  try {
    await atproto.value.signIn(identifier.value);
    view.value = "accounts";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    unknownHandle.value =
      /does not resolve to a DID|does not include the handle|Invalid handle|Unable to resolve handle/i.test(
        message,
      );
    error.value = unknownHandle.value
      ? t("settings.syncUnknownHandle", { identifier: identifier.value })
      : message;
    view.value = "signin";
  } finally {
    busy.value = false;
  }
}

function chooseHost(host: AccountHost): void {
  selectedHost.value = host;
  hostOpened.value = false;
}

async function continueToHost(): Promise<void> {
  const host = selectedHost.value;
  if (!host) return;

  hostOpened.value = true;
  await openExternal(host.signupUrl);
}

function accountName(account: AtprotoAccount): string {
  return account.displayName || account.handle || shortDid(account.did);
}

async function switchAccount(did: string): Promise<void> {
  if (switching.value || signingOut.value || removing.value) return;
  if (did === atprotoStatus.value.did) return;

  switching.value = did;
  accountError.value = "";
  try {
    await atproto.value?.switchAccount(did);
  } catch (cause) {
    accountError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    switching.value = null;
  }
}

function askRemoveAccount(account: AtprotoAccount): void {
  removeTarget.value = account;
}

async function confirmRemoveAccount(): Promise<void> {
  const account = removeTarget.value;
  if (!account) return;

  removeTarget.value = null;
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

async function signOut(): Promise<void> {
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

async function deleteInstallRecord(): Promise<void> {
  if (installBusy.value || !atproto.value) return;

  installBusy.value = true;
  try {
    await atproto.value.deleteInstallRecord();
    pushToast({ titleKey: "account.installDeleted", duration: 2500 });
  } catch (cause) {
    pushToast({
      title: cause instanceof Error ? cause.message : String(cause),
      variant: "danger",
      duration: 4000,
    });
  } finally {
    installBusy.value = false;
  }
}

function openProfile(): void {
  const did = atprotoStatus.value.did;
  if (!did) return;

  hide();
  void navigateTo(`/u/${did}`);
}

function ago(timestamp: number): string {
  return timestamp
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: "medium" }).format(timestamp)
    : t("settings.syncNever");
}
</script>

<template>
  <UiDialog v-model:open="open" class="account-dialog" layer="top" :title="dialogTitle">
    <button
      type="button"
      class="account-dialog__close"
      :aria-label="$t('common.close')"
      @click="hide"
    >
      <MsIcon name="close" :size="20" />
    </button>

    <div v-if="effectiveView === 'signin'" class="account-dialog__view">
      <!-- <p class="account-dialog__intro">
        {{ atprotoStatus.signedIn ? $t("account.addAnotherIntro") : $t("account.signInIntro") }}
      </p> -->

      <p v-if="!atprotoReady" class="account-dialog__hint">{{ $t("account.notReady") }}</p>

      <UiButton variant="primary" size="large" class="account-dialog__wide" @click="openCreate">
        {{ $t("account.createAccount") }}
      </UiButton>

      <p class="account-dialog__or">{{ $t("account.or") }}</p>
      <p class="account-dialog__label">
        {{ atprotoStatus.signedIn ? $t("account.addAnother") : $t("account.alreadyHave") }}
      </p>

      <form class="account-dialog__form" @submit.prevent="startSignIn">
        <div class="account-dialog__field">
          <label class="account-dialog__field-label" for="account-handle">
            {{ $t("account.handle") }}
          </label>
          <UiTextField
            id="account-handle"
            v-model="identifier"
            :placeholder="$t('account.handlePlaceholder')"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            :disabled="busy || !atprotoReady"
            :aria-label="$t('account.handle')"
            @keydown.esc="suggestionsOpen = false"
          />
          <ul v-if="suggestionsOpen && suggestions.length" class="account-dialog__suggestions">
            <li v-for="suggestion in suggestions" :key="suggestion.did">
              <button
                type="button"
                class="account-dialog__suggestion"
                @click="pickSuggestion(suggestion)"
              >
                <img
                  v-if="suggestion.avatar"
                  class="account-dialog__suggestion-avatar"
                  :src="suggestion.avatar"
                  alt=""
                />
                <MsIcon
                  v-else
                  class="account-dialog__suggestion-avatar account-dialog__suggestion-avatar--icon"
                  name="account_circle"
                  :size="28"
                />
                <span class="account-dialog__suggestion-copy">
                  <span class="account-dialog__suggestion-name">
                    {{ suggestion.displayName || suggestion.handle }}
                  </span>
                  <span class="account-dialog__suggestion-handle">@{{ suggestion.handle }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <UiButton
          type="submit"
          variant="primary"
          size="large"
          class="account-dialog__wide"
          :disabled="busy || !atprotoReady || !identifier.trim()"
        >
          {{ busy ? $t("account.checking") : $t("account.continue") }}
        </UiButton>
      </form>

      <p v-if="error" class="account-dialog__error" role="alert">
        <MsIcon name="error" :size="18" />
        <span>
          {{ error }}
          <button
            v-if="unknownHandle"
            type="button"
            class="account-dialog__link"
            @click="openCreate"
          >
            {{ $t("account.createAccount") }}
          </button>
        </span>
      </p>

      <!-- <p class="account-dialog__apps">{{ $t("account.worksWith", { apps: appList }) }}</p> -->

      <div class="account-dialog__footer-links">
        <!-- <button type="button" class="account-dialog__link" @click="openData">
          {{ $t("account.whatWrites") }}
        </button> -->
        <!-- <button type="button" class="account-dialog__link" @click="hide">
          {{ $t("account.withoutAccount") }}
        </button> -->
      </div>
    </div>

    <div v-else-if="effectiveView === 'create'" class="account-dialog__view">
      <template v-if="!selectedHost">
        <p class="account-dialog__intro">{{ $t("account.createIntro") }}</p>

        <UiButton
          variant="primary"
          size="large"
          class="account-dialog__wide"
          @click="chooseHost(defaultHost)"
        >
          {{ $t("account.createWithBluesky") }}
        </UiButton>

        <!-- <p class="account-dialog__hint">{{ $t("account.providerNote") }}</p> -->

        <button type="button" class="account-dialog__link" @click="hostsOpen = !hostsOpen">
          {{ $t("account.chooseProvider") }}
        </button>

        <ul v-if="hostsOpen" class="account-dialog__hosts">
          <li v-for="host in otherHosts" :key="host.id">
            <button type="button" class="account-dialog__host" @click="chooseHost(host)">
              <span class="account-dialog__host-copy">
                <span class="account-dialog__host-name">{{ host.name }}</span>
                <span class="account-dialog__host-note">{{ host.note }}</span>
              </span>
            </button>
          </li>
        </ul>

        <p v-if="hostsOpen" class="account-dialog__hint">
          {{ $t("account.moreProviders") }}
          <button
            type="button"
            class="account-dialog__link"
            @click="openExternal(ACCOUNT_HOSTS_URL)"
          >
            {{ $t("account.moreProvidersLink") }}
          </button>
        </p>

        <div class="account-dialog__footer-links">
          <button type="button" class="account-dialog__link" @click="openSignIn">
            {{ $t("account.alreadyHaveAccount") }}
          </button>
          <!-- <button type="button" class="account-dialog__link" @click="openData">
            {{ $t("account.whatWrites") }}
          </button> -->
        </div>
      </template>

      <template v-else>
        <div class="account-dialog__confirm">
          <MsIcon name="open_in_new" :size="28" class="account-dialog__confirm-icon" />
          <h3 class="account-dialog__confirm-title">
            {{ $t("account.createOn", { host: selectedHost.name }) }}
          </h3>
          <p class="account-dialog__intro">
            {{
              $t("account.providerRedirect", { host: selectedHost.name, domain: selectedHost.host })
            }}
          </p>
          <p class="account-dialog__hint">{{ $t("account.passwordNote") }}</p>
        </div>

        <UiButton
          variant="primary"
          size="large"
          class="account-dialog__wide"
          @click="continueToHost"
        >
          {{ $t("account.continueTo", { host: selectedHost.name }) }}
        </UiButton>

        <p v-if="hostOpened" class="account-dialog__hint">{{ $t("account.hostOpened") }}</p>

        <div class="account-dialog__actions">
          <UiButton variant="plain" @click="selectedHost = null">
            {{ $t("account.back") }}
          </UiButton>
          <UiButton variant="plain" @click="openSignIn">
            {{ $t("account.iCreated") }}
          </UiButton>
        </div>
      </template>
    </div>

    <div v-else-if="effectiveView === 'permissions'" class="account-dialog__view">
      <p class="account-dialog__intro">
        {{ $t("account.permissionsIntro", { handle: identifier || $t("account.yourAccount") }) }}
      </p>

      <ul class="account-dialog__scopes">
        <li v-for="group in ACCOUNT_SCOPE_GROUPS" :key="group.id" class="account-dialog__scope">
          <span class="account-dialog__scope-icon">
            <MsIcon :name="group.icon" :size="20" />
          </span>
          <span class="account-dialog__scope-copy">
            <span class="account-dialog__scope-title">{{ $t(group.titleKey) }}</span>
            <span class="account-dialog__scope-body">{{ $t(group.bodyKey) }}</span>
          </span>
        </li>
      </ul>

      <p class="account-dialog__hint">{{ $t("account.permissionsTogether") }}</p>

      <details class="account-dialog__technical">
        <summary>{{ $t("account.technicalDetails") }}</summary>
        <div
          v-for="group in ACCOUNT_SCOPE_GROUPS"
          :key="group.id"
          class="account-dialog__technical-group"
        >
          <h4>{{ $t(group.titleKey) }}</h4>
          <ul>
            <li v-for="scope in group.scopes" :key="scope">
              <code>{{ scope }}</code>
            </li>
          </ul>
        </div>
      </details>

      <p v-if="error" class="account-dialog__error" role="alert">{{ error }}</p>

      <div class="account-dialog__actions">
        <UiButton variant="plain" @click="backToSignIn">
          {{ $t("account.back") }}
        </UiButton>
        <UiButton variant="primary" size="large" :disabled="busy" @click="authorize">
          {{ busy ? $t("account.authorizing") : $t("account.authorize") }}
        </UiButton>
      </div>

      <!-- <button type="button" class="account-dialog__link account-dialog__center" @click="openData">
        {{ $t("account.whatWrites") }}
      </button> -->
    </div>

    <div v-else-if="effectiveView === 'accounts'" class="account-dialog__view">
      <div class="account-dialog__active">
        <img v-if="activeAvatar" class="account-dialog__avatar" :src="activeAvatar" alt="" />
        <MsIcon
          v-else
          class="account-dialog__avatar account-dialog__avatar--placeholder"
          name="account_circle"
          :size="48"
        />
        <div class="account-dialog__active-copy">
          <span class="account-dialog__active-name">{{ activeName }}</span>
          <span v-if="activeHandle" class="account-dialog__handle">@{{ activeHandle }}</span>
          <span class="account-dialog__did">{{ atprotoStatus.did }}</span>
        </div>
        <UiIconButton
          icon="logout"
          variant="ghost"
          danger
          :size="20"
          :label="signingOut ? $t('account.signingOut') : $t('account.signOut')"
          :disabled="signingOut || Boolean(switching) || removing"
          @click="signOut"
        />
      </div>

      <p v-if="atprotoStatus.profile?.description" class="account-dialog__bio">
        {{ atprotoStatus.profile.description }}
      </p>

      <div class="account-dialog__actions">
        <UiButton variant="plain" icon="open_in_new" @click="openProfile">
          {{ $t("account.viewProfile") }}
        </UiButton>
        <!-- <UiButton variant="plain" @click="openData">
          {{ $t("account.whatWrites") }}
        </UiButton> -->
      </div>

      <div class="account-dialog__section">
        <div class="account-dialog__section-head">
          <h3 class="account-dialog__section-title">{{ $t("account.otherAccounts") }}</h3>
          <UiButton variant="plain" icon="add" @click="openSignIn">
            {{ $t("account.addAccount") }}
          </UiButton>
        </div>

        <p v-if="otherAccounts.length" class="account-dialog__hint">
          {{ $t("account.switchHint") }}
        </p>

        <ul v-if="otherAccounts.length" class="account-dialog__accounts">
          <li v-for="account in otherAccounts" :key="account.did" class="account-dialog__account">
            <img
              v-if="account.avatar"
              class="account-dialog__account-avatar"
              :src="account.avatar"
              alt=""
            />
            <MsIcon
              v-else
              class="account-dialog__account-avatar account-dialog__account-avatar--placeholder"
              name="account_circle"
              :size="32"
            />
            <span class="account-dialog__account-copy">
              <span class="account-dialog__account-name">{{ accountName(account) }}</span>
              <span class="account-dialog__account-meta">
                <span v-if="account.handle" class="account-dialog__handle"
                  >@{{ account.handle }}</span
                >
                <span class="account-dialog__did">{{ shortDid(account.did) }}</span>
              </span>
            </span>
            <span class="account-dialog__account-actions">
              <UiButton
                variant="plain"
                size="small"
                :disabled="Boolean(switching) || signingOut || removing"
                @click="switchAccount(account.did)"
              >
                {{ switching === account.did ? $t("account.switching") : $t("account.switch") }}
              </UiButton>
              <UiIconButton
                icon="person_remove"
                variant="ghost"
                danger
                :size="18"
                :label="`${$t('account.remove')} ${accountName(account)}`"
                :disabled="Boolean(switching) || signingOut || removing"
                @click="askRemoveAccount(account)"
              />
            </span>
          </li>
        </ul>

        <p v-else class="account-dialog__hint">{{ $t("account.noOtherAccounts") }}</p>
      </div>

      <div v-if="removeTarget" class="account-dialog__inline-confirm" role="alertdialog">
        <p class="account-dialog__hint">
          {{ $t("account.removeConfirm", { name: accountName(removeTarget) }) }}
        </p>
        <div class="account-dialog__actions">
          <UiButton variant="plain" @click="removeTarget = null">
            {{ $t("common.cancel") }}
          </UiButton>
          <UiButton variant="danger" :disabled="removing" @click="confirmRemoveAccount">
            {{ $t("account.remove") }}
          </UiButton>
        </div>
      </div>

      <p v-if="accountError" class="account-dialog__error" role="alert">{{ accountError }}</p>

      <p class="account-dialog__hint">
        {{ $t("account.lastUsed", { time: ago(activeAccount?.lastUsedAt ?? 0) }) }}
      </p>
    </div>

    <div v-else class="account-dialog__view">
      <AccountDataLabel
        :signed-in="atprotoStatus.signedIn"
        :busy="installBusy"
        @delete-install="deleteInstallRecord"
      />
      <div class="account-dialog__actions">
        <UiButton variant="plain" @click="closeData">
          {{ $t("account.back") }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.account-dialog {
  width: min(560px, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - var(--space-12) - var(--safe-top) - var(--safe-bottom));
}

.account-dialog .dialog__title {
  padding-right: var(--space-8);
}

.account-dialog__close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: grid;
  width: var(--control-sm);
  height: var(--control-sm);
  place-items: center;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.account-dialog__close:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.account-dialog__view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.account-dialog__intro,
.account-dialog__hint,
.account-dialog__label,
.account-dialog__apps,
.account-dialog__bio {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.account-dialog__intro {
  text-align: center;
}

.account-dialog__label {
  font-weight: 600;
  color: var(--color-text);
}

.account-dialog__or {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-1) 0;
  font-size: var(--text-xs);
  text-align: center;
  color: var(--color-text-tertiary);
}

.account-dialog__or::before,
.account-dialog__or::after {
  flex: 1;
  height: 1px;
  content: "";
  background: var(--color-border);
}

.account-dialog__wide {
  width: 100%;
  justify-content: center;
}

.account-dialog__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.account-dialog__field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.account-dialog__field-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.account-dialog__suggestions {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 2;
  max-height: 14rem;
  margin: var(--space-1) 0 0;
  padding: var(--space-1);
  overflow-y: auto;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-2);
}

.account-dialog__suggestion {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.account-dialog__suggestion:hover {
  background: var(--color-accent-soft);
}

.account-dialog__suggestion-avatar {
  width: 28px;
  height: 28px;
  flex: none;
  object-fit: cover;
  border-radius: 50%;
}

.account-dialog__suggestion-avatar--icon {
  color: var(--color-text-tertiary);
}

.account-dialog__suggestion-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.account-dialog__suggestion-name {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.account-dialog__suggestion-handle {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.account-dialog__error {
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

.account-dialog__error .ms-icon {
  flex: none;
  margin-top: 0.1rem;
}

.account-dialog__apps {
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  text-align: center;
}

.account-dialog__footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2) var(--space-4);
}

.account-dialog__link {
  padding: 0;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-accent);
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.account-dialog__link:hover {
  text-decoration: underline;
}

.account-dialog__center {
  text-align: center;
}

.account-dialog__hosts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-dialog__host {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2);
  text-align: left;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.account-dialog__host:hover {
  border-color: var(--color-border-strong);
}

.account-dialog__host-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
}

.account-dialog__host-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.account-dialog__host-note {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.account-dialog__confirm {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  text-align: center;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.account-dialog__confirm-icon {
  color: var(--color-accent);
}

.account-dialog__confirm-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}

.account-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.account-dialog__scopes {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-dialog__scope {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.account-dialog__scope-icon {
  display: grid;
  flex: none;
  width: 2rem;
  height: 2rem;
  place-items: center;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-full);
}

.account-dialog__scope-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.account-dialog__scope-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.account-dialog__scope-body {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.account-dialog__technical {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.account-dialog__technical summary {
  cursor: pointer;
}

.account-dialog__technical-group {
  margin-top: var(--space-2);
}

.account-dialog__technical-group h4 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text);
}

.account-dialog__technical-group ul {
  margin: 0;
  padding-left: var(--space-4);
}

.account-dialog__technical-group code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.account-dialog__active {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.account-dialog__avatar {
  width: 48px;
  height: 48px;
  flex: none;
  object-fit: cover;
  border-radius: 50%;
}

.account-dialog__avatar--placeholder {
  color: var(--color-text-tertiary);
}

.account-dialog__active-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.account-dialog__active-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text);
}

.account-dialog__handle {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.account-dialog__did {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}

.account-dialog__bio {
  font-size: var(--text-sm);
}

.account-dialog__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.account-dialog__inline-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}

.account-dialog__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.account-dialog__section-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
}

.account-dialog__accounts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-dialog__account {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.account-dialog__account-avatar {
  width: 32px;
  height: 32px;
  flex: none;
  object-fit: cover;
  border-radius: 50%;
}

.account-dialog__account-avatar--placeholder {
  color: var(--color-text-tertiary);
}

.account-dialog__account-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.account-dialog__account-name {
  font-size: var(--text-sm);
  font-weight: 600;
}

.account-dialog__account-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
}

.account-dialog__account-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.account-dialog__account-actions .button {
  white-space: nowrap;
}

@media (max-width: 40rem) {
  .account-dialog {
    width: calc(100vw - var(--space-4));
    max-height: calc(100dvh - var(--space-8) - var(--safe-top) - var(--safe-bottom));
  }

  .account-dialog__actions {
    flex-wrap: wrap;
  }
}
</style>
