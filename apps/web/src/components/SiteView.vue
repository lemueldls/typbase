<script setup lang="ts">
import type { PageMeta, SitePageSettings, SiteSettings, SiteVisibility } from "@typbase/typing";

import { wispSiteUrl } from "@typbase/spaces";

import type { SitePublishProgress } from "~/lib/site/publish";

import { useWorkspaceValue } from "~/composables/loro";
import { pushToast } from "~/composables/toasts";
import { saveExport } from "~/lib/exportPage";
import { openExternal } from "~/lib/openExternal";
import { buildSite, siteBaseUrl, siteRkey } from "~/lib/site/build";
import { publishSite, unpublishSite, wispClient } from "~/lib/site/publish";
import { createZip } from "~/lib/zip";

const props = defineProps<{
  store: import("@typbase/storage").WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "openPage", id: string): void;
}>();

const { t } = useI18n();
const { atproto, atprotoStatus, localState } = useWorkspace();

const settings = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getSettings(),
);
const pages = useWorkspaceValue(
  () => props.store,
  ["pages"],
  (store) => store.listPages(),
);
const site = computed(() => settings.value.site);

type SiteTab = "pages" | "design" | "domain" | "publish";

const tab = ref<SiteTab>("pages");
const siteView = useTemplateRef<HTMLElement>("siteView");
const busy = ref(false);
const error = ref("");
const progress = ref<SitePublishProgress | null>(null);
const resultNote = ref("");
const publishingReady = ref(true);

async function checkPublishingScope(): Promise<void> {
  publishingReady.value = atproto.value ? await atproto.value.hasSitePublishingScope() : true;
}

onMounted(checkPublishingScope);
watch(
  () => atprotoStatus.value.did,
  () => void checkPublishingScope(),
);

async function reconnectForPublishing(): Promise<void> {
  if (!atproto.value) return;
  busy.value = true;
  error.value = "";
  try {
    await atproto.value.reauthorize();
    await checkPublishingScope();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
const sharedUrl = computed(() => {
  const did = atprotoStatus.value.did;
  if (!did) return "";
  const key = siteRkey(site.value, settings.value.name);

  return wispSiteUrl(did, key, site.value.wisp.serviceUrl);
});
const displayUrl = computed(() => {
  if (site.value.wisp.domainStatus === "verified") {
    return siteBaseUrl(site.value, atprotoStatus.value.did) || sharedUrl.value;
  }
  if (site.value.wisp.lastDeploy?.url) return site.value.wisp.lastDeploy.url;

  return sharedUrl.value;
});
const openSiteUrl = computed(() => (site.value.wisp.lastDeploy ? displayUrl.value : ""));
const headerSub = computed(() =>
  site.value.wisp.lastDeploy
    ? displayUrl.value
    : [t("site.notPublished"), displayUrl.value].filter(Boolean).join(" · "),
);

const visibilityOptions = computed(() => [
  { value: "public", label: t("site.visibilityPublic") },
  { value: "unlisted", label: t("site.visibilityUnlisted") },
  { value: "private", label: t("site.visibilityPrivate") },
]);

const themeOptions = computed(() => [
  { value: "workspace", label: t("site.themeWorkspace") },
  { value: "light", label: t("site.themeLight") },
]);

const navigationOptions = computed(() => [
  { value: "sidebar", label: t("site.navSidebar") },
  { value: "top", label: t("site.navTop") },
  { value: "both", label: t("site.navBoth") },
  { value: "none", label: t("site.navNone") },
]);

const GENERATED_HOME = "__generated";

const homeOptions = computed(() => [
  { value: GENERATED_HOME, label: t("site.homeGenerated") },
  ...pages.value
    .filter((page) => visibilityOf(page) !== "private")
    .map((page) => ({ value: page.id, label: pageSettings(page).title || page.title })),
]);

const publicCount = computed(
  () => pages.value.filter((page) => visibilityOf(page) === "public").length,
);
const includedCount = computed(
  () => pages.value.filter((page) => visibilityOf(page) !== "private").length,
);
const includedPages = computed(() =>
  pages.value.filter((page) => visibilityOf(page) !== "private"),
);

type PageFilter = "all" | "included" | "public" | "private";

const pageFilter = ref<PageFilter>("all");
const pageQuery = ref("");
const pageSearch = useTemplateRef<{ focus: () => void }>("pageSearch");

const pageFilters = computed(() => [
  { value: "all", label: t("site.filterAll"), count: pages.value.length },
  {
    value: "included",
    label: t("site.filterIncluded"),
    count: includedCount.value,
  },
  { value: "public", label: t("site.filterPublic"), count: publicCount.value },
  {
    value: "private",
    label: t("site.filterPrivate"),
    count: pages.value.length - includedCount.value,
  },
]);

const filteredPages = computed(() => {
  const query = pageQuery.value.trim().toLocaleLowerCase();
  return pages.value.filter((page) => {
    const visibility = visibilityOf(page);
    if (pageFilter.value === "included" && visibility === "private") return false;
    if (pageFilter.value === "public" && visibility !== "public") return false;
    if (pageFilter.value === "private" && visibility !== "private") return false;
    if (!query) return true;

    const config = pageSettings(page);
    const search = [
      page.title,
      page.path,
      config.title ?? "",
      config.slug ?? "",
      ...(config.tags ?? page.tags),
    ]
      .join(" ")
      .toLocaleLowerCase();

    return search.includes(query);
  });
});

const publishBlockReason = computed(() => {
  if (!atprotoStatus.value.signedIn) return t("site.publishBlockedSignedOut");
  if (!publishingReady.value) return t("site.publishBlockedScope");
  if (!includedCount.value) return t("site.publishBlockedNoPages");
  return "";
});

const publishDisabled = computed(
  () =>
    busy.value ||
    !atprotoStatus.value.signedIn ||
    !publishingReady.value ||
    includedCount.value === 0,
);

const progressPercent = computed(() => {
  const entry = progress.value;
  if (!entry?.total) return null;
  return Math.min(100, Math.round(((entry.done ?? 0) / entry.total) * 100));
});

function visibilityOf(page: PageMeta): SiteVisibility {
  return site.value.pages[page.id]?.visibility ?? site.value.defaultVisibility;
}

function pageSettings(page: PageMeta): SitePageSettings {
  return site.value.pages[page.id] ?? {};
}

function includedVisibility(page: PageMeta): SiteVisibility {
  const current = pageSettings(page).visibility;
  if (current === "public" || current === "unlisted") return current;

  return site.value.defaultVisibility === "unlisted" ? "unlisted" : "public";
}

function updateSite(patch: Partial<SiteSettings>): void {
  props.store.updateSettings({ site: { ...site.value, ...patch } });
}

function updateWisp(patch: Partial<SiteSettings["wisp"]>): void {
  updateSite({ wisp: { ...site.value.wisp, ...patch } });
}

function updateStandard(patch: Partial<SiteSettings["standard"]>): void {
  updateSite({ standard: { ...site.value.standard, ...patch } });
}

function updatePage(page: PageMeta, patch: Partial<SitePageSettings>): void {
  updateSite({
    pages: {
      ...site.value.pages,
      [page.id]: { ...pageSettings(page), ...patch },
    },
  });
}

function setVisibility(page: PageMeta, visibility: SiteVisibility): void {
  updatePage(page, { visibility });
}

function toggleIncluded(page: PageMeta, included: boolean): void {
  setVisibility(page, included ? includedVisibility(page) : "private");
}

/** Apply one visibility to every page matching the current search and filter. */
function setVisibilityShown(visibility: SiteVisibility | "included"): void {
  const next = { ...site.value.pages };
  for (const page of filteredPages.value) {
    const value = visibility === "included" ? includedVisibility(page) : visibility;
    next[page.id] = { ...next[page.id], visibility: value };
  }
  updateSite({ pages: next });
}

function editSelection(): void {
  selectTab("pages");
  pageFilter.value = includedCount.value ? "included" : "all";
  if (!includedCount.value) pageQuery.value = "";
  void nextTick(() => pageSearch.value?.focus());
}

function selectTab(next: SiteTab): void {
  tab.value = next;
  void nextTick(() => siteView.value?.scrollTo({ top: 0 }));
}

function reviewAndPublish(): void {
  selectTab("publish");
}

async function onPublish(): Promise<void> {
  if (!atproto.value || busy.value) return;
  busy.value = true;
  error.value = "";
  resultNote.value = "";
  progress.value = { stage: "build", message: t("site.publishing") };
  try {
    const result = await publishSite(props.store, atproto.value, {
      local: localState.value,
      onProgress: (entry) => (progress.value = entry),
    });
    resultNote.value = t("site.publishedFiles", {
      pages: result.deploy.pageCount,
      files: result.deploy.fileCount,
      reused: result.reused,
    });
    if (result.standardSkipped) resultNote.value += ` ${result.standardSkipped}`;
    if (result.build.warnings.length) {
      resultNote.value += ` ${result.build.warnings.slice(0, 3).join(" ")}`;
    }
    pushToast({ titleKey: "site.published", duration: 4000 });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

const confirmUnpublish = ref(false);

async function onUnpublish(): Promise<void> {
  if (!atproto.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await unpublishSite(props.store, atproto.value);
    resultNote.value = "";
    pushToast({ titleKey: "site.unpublished", duration: 3000 });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

const previewOpen = ref(false);
const previewHtml = ref("");

async function openPreview(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    const prepared: SiteSettings = {
      ...site.value,
      wisp: { ...site.value.wisp, siteRkey: siteRkey(site.value, settings.value.name) },
    };
    const build = await buildSite(props.store, prepared, {
      baseUrl: siteBaseUrl(prepared, atprotoStatus.value.did),
      did: atprotoStatus.value.did,
    });
    const home = build.files.find((file) => file.name === "index.html");
    if (!home) throw new Error("The site has no home page.");
    previewHtml.value = inlinePreview(build.files, new TextDecoder().decode(home.bytes));
    previewOpen.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function downloadSite(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    const prepared: SiteSettings = {
      ...site.value,
      wisp: { ...site.value.wisp, siteRkey: siteRkey(site.value, settings.value.name) },
    };
    const build = await buildSite(props.store, prepared, {
      baseUrl: siteBaseUrl(prepared, atprotoStatus.value.did),
      did: atprotoStatus.value.did,
    });
    const zip = createZip(build.files.map((file) => ({ name: file.name, bytes: file.bytes })));
    await saveExport(`${build.slug}.zip`, [{ name: `${build.slug}.zip`, bytes: zip }]);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

function inlinePreview(files: Array<{ name: string; bytes: Uint8Array }>, html: string): string {
  const byName = new Map(files.map((file) => [file.name, file.bytes]));
  const css = byName.get("assets/site.css");
  let output = html;
  if (css) {
    const text = new TextDecoder()
      .decode(css)
      .replace(/url\("\.\.\/([^"]+)"\)/g, (_match, path: string) => {
        const bytes = byName.get(path);
        return bytes ? `url("data:${mimeFor(path)};base64,${base64(bytes)}")` : `url("../${path}")`;
      });
    output = output.replace(
      /<link rel="stylesheet" href="[^"]*assets\/site\.css">/,
      `<style>${text}</style>`,
    );
  }
  output = output.replace(/<script src="[^"]*assets\/site\.js" defer><\/script>/, "");
  output = output.replace(/<script src="[^"]*assets\/site\.js"><\/script>/, "");
  output = output.replace(/src="(?:\.\/|\.\.\/)*(assets\/[^"]+)"/g, (_match, path: string) => {
    const bytes = byName.get(path);
    return bytes ? `src="data:${mimeFor(path)};base64,${base64(bytes)}"` : `src="${path}"`;
  });
  output = output.replace(/href="(?:\.\/|\.\.\/)+[^"]*"/g, 'href="#"');

  return output;
}

function mimeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";

  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      otf: "font/otf",
      ttf: "font/ttf",
    }[extension] ?? "application/octet-stream"
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

const subdomainInput = ref("");
const customDomainInput = ref("");
const domainBusy = ref(false);
const domainError = ref("");
const domainInfo = computed(() => site.value.wisp.domainDns);
const releaseOpen = ref(false);
const releaseKind = ref<"custom" | "subdomain" | null>(null);

const domainStatusKeys = {
  none: "site.domainStatusNone",
  pending: "site.domainStatusPending",
  verified: "site.domainStatusVerified",
  error: "site.domainStatusError",
} as const;
const domainStatusLabel = computed(() => t(domainStatusKeys[site.value.wisp.domainStatus]));
const activeDomain = computed(
  () =>
    site.value.wisp.customDomain ||
    (site.value.wisp.subdomain ? `${site.value.wisp.subdomain}.wisp.place` : ""),
);
const activeDomainUrl = computed(() => (activeDomain.value ? `https://${activeDomain.value}` : ""));
const deployedOnDomain = computed(
  () =>
    Boolean(site.value.wisp.lastDeploy) &&
    Boolean(activeDomain.value) &&
    site.value.wisp.lastDeploy?.url === activeDomainUrl.value,
);
const customDomainSteps = computed(() => {
  const claimed = Boolean(site.value.wisp.customDomain);
  const verified = site.value.wisp.domainStatus === "verified";

  return [
    {
      label: t("site.domainStepClaim"),
      state: claimed ? "done" : "current",
    },
    {
      label: t("site.domainStepDns"),
      state: !claimed ? "pending" : verified ? "done" : "current",
    },
    {
      label: t("site.domainStepVerify"),
      state: verified ? "done" : "pending",
    },
  ] as const;
});

function domainClient() {
  const atprotoValue = atproto.value;
  if (!atprotoValue) throw new Error(t("site.signInFirst"));
  const session = atprotoValue.requireSession();

  return wispClient(site.value, session);
}

async function claimSubdomain(): Promise<void> {
  const label = subdomainInput.value.trim().toLowerCase();
  if (!label) return;
  domainBusy.value = true;
  domainError.value = "";
  try {
    const key = siteRkey(site.value, settings.value.name);
    const result = await domainClient().domains.claimSubdomain(label, key);
    updateWisp({
      siteRkey: key,
      subdomain: result.domain?.replace(/\.wisp\.place$/, "") || label,
      domainStatus: result.status === "verified" ? "verified" : "pending",
      domainError: "",
      lastDeploy: site.value.wisp.lastDeploy,
    });
    subdomainInput.value = "";
    pushToast({ titleKey: "site.domainClaimed", duration: 3000 });
  } catch (cause) {
    domainError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    domainBusy.value = false;
  }
}

async function claimCustomDomain(): Promise<void> {
  const domain = customDomainInput.value.trim().toLowerCase();
  if (!domain) return;
  domainBusy.value = true;
  domainError.value = "";
  try {
    const key = siteRkey(site.value, settings.value.name);
    const result = await domainClient().domains.claimCustom(domain, key);
    updateWisp({
      siteRkey: key,
      customDomain: result.domain || domain,
      domainStatus: result.status === "verified" ? "verified" : "pending",
      domainDns:
        result.txtName && result.txtValue
          ? {
              txtName: result.txtName,
              txtValue: result.txtValue,
              cnameTarget: result.cnameTarget ?? "",
            }
          : null,
    });
    customDomainInput.value = "";
  } catch (cause) {
    domainError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    domainBusy.value = false;
  }
}

async function refreshDomain(): Promise<void> {
  const domain = site.value.wisp.customDomain || site.value.wisp.subdomain;
  if (!domain) return;
  domainBusy.value = true;
  domainError.value = "";
  try {
    const status = await domainClient().domains.status(
      site.value.wisp.customDomain || `${site.value.wisp.subdomain}.wisp.place`,
    );
    updateWisp({
      domainStatus: status.verified || status.status === "verified" ? "verified" : "pending",
      domainError: status.lastError ?? "",
    });
  } catch (cause) {
    domainError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    domainBusy.value = false;
  }
}

function askRelease(kind: "custom" | "subdomain"): void {
  releaseKind.value = kind;
  releaseOpen.value = true;
}

async function confirmRelease(): Promise<void> {
  const kind = releaseKind.value;
  releaseKind.value = null;
  if (!kind) return;
  await releaseDomain(kind);
}

async function publishWithDomain(): Promise<void> {
  selectTab("publish");
  await nextTick();
  await onPublish();
}

watch(tab, (value) => {
  if (value !== "domain" || domainBusy.value || !atprotoStatus.value.signedIn) return;
  if (site.value.wisp.domainStatus === "pending" && activeDomain.value) void refreshDomain();
});

async function releaseDomain(kind: "custom" | "subdomain"): Promise<void> {
  const domain =
    kind === "custom"
      ? site.value.wisp.customDomain
      : site.value.wisp.subdomain
        ? `${site.value.wisp.subdomain}.wisp.place`
        : "";
  if (!domain) return;
  domainBusy.value = true;
  domainError.value = "";
  try {
    await domainClient().domains.deleteDomain(domain);
    const shared = sharedUrl.value;
    const lastDeploy = site.value.wisp.lastDeploy
      ? { ...site.value.wisp.lastDeploy, url: shared }
      : null;
    updateWisp(
      kind === "custom"
        ? {
            customDomain: "",
            domainStatus: site.value.wisp.subdomain ? "verified" : "none",
            domainDns: null,
            domainError: "",
            lastDeploy,
          }
        : {
            subdomain: "",
            domainStatus: site.value.wisp.customDomain ? "verified" : "none",
            domainDns: null,
            domainError: "",
            lastDeploy,
          },
    );
  } catch (cause) {
    domainError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    domainBusy.value = false;
  }
}

function copy(value: string): Promise<void> {
  if (!value) return Promise.resolve();
  return navigator.clipboard.writeText(value).then(() => {
    pushToast({ titleKey: "common.copied", duration: 1800 });
  });
}
</script>

<template>
  <section class="site-view">
    <header class="site-view__header">
      <div class="site-view__heading">
        <slot name="nav-toggle" />
        <div class="site-view__title-group">
          <!-- <MsIcon name="public" :size="24" /> -->
          <div class="site-view__title-copy">
            <h1 class="site-view__title">{{ $t("site.title") }}</h1>
            <!-- <p class="site-view__sub">{{ headerSub }}</p> -->
          </div>
        </div>
      </div>
      <div class="site-view__actions">
        <UiButton v-if="displayUrl" variant="plain" icon="content_copy" @click="copy(displayUrl)">
          {{ $t("site.copyUrl") }}
        </UiButton>
        <UiButton
          v-if="openSiteUrl"
          variant="plain"
          icon="open_in_new"
          @click="openExternal(openSiteUrl)"
        >
          {{ $t("site.openSite") }}
        </UiButton>
      </div>
      <UiIconButton
        class="site-view__close"
        icon="close"
        :label="$t('common.close')"
        @click="emit('close')"
      />
    </header>

    <div class="site-view__tabs" role="tablist">
      <button
        v-for="entry in ['pages', 'design', 'domain', 'publish'] as const"
        :key="entry"
        type="button"
        class="site-view__tab"
        :class="{ 'site-view__tab--active': tab === entry }"
        role="tab"
        :aria-selected="tab === entry"
        @click="selectTab(entry)"
      >
        {{ $t(`site.tab_${entry}`) }}
        <span v-if="entry === 'publish' && includedCount" class="site-view__tab-count">
          {{ includedCount }}
        </span>
      </button>
    </div>

    <div ref="siteView" class="site-view__body">
      <section v-if="!atprotoStatus.signedIn" class="site-signin">
        <div class="site-signin__intro">
          <span class="site-signin__icon"><MsIcon name="account_circle" :size="24" /></span>
          <div>
            <h2>{{ $t("site.signInTitle") }}</h2>
            <p>{{ $t("site.signInBody") }}</p>
          </div>
        </div>
        <AtprotoSignIn compact />
      </section>

      <p v-if="atprotoStatus.signedIn && !publishingReady" class="site-view__note">
        {{ $t("site.scopeHint") }}
        <UiButton variant="plain" :disabled="busy" @click="reconnectForPublishing">
          {{ $t("site.reconnect") }}
        </UiButton>
      </p>

      <div v-if="tab === 'pages'" class="site-view__panel">
        <div class="site-pages__toolbar">
          <UiTextField
            ref="pageSearch"
            v-model="pageQuery"
            class="site-pages__search"
            :label="$t('site.searchPages')"
            :placeholder="$t('site.searchPages')"
          >
            <template #leading><MsIcon name="search" :size="20" /></template>
          </UiTextField>
          <div class="site-pages__filters" role="group" :aria-label="$t('site.filterPages')">
            <button
              v-for="filter in pageFilters"
              :key="filter.value"
              type="button"
              class="site-pages__filter"
              :class="{ 'site-pages__filter--active': pageFilter === filter.value }"
              :aria-pressed="pageFilter === filter.value"
              @click="pageFilter = filter.value as PageFilter"
            >
              {{ filter.label }}
              <span>{{ filter.count }}</span>
            </button>
          </div>
        </div>

        <div class="site-pages__bulk">
          <span class="site-view__count">
            {{
              $t("site.showingPages", {
                shown: filteredPages.length,
                total: pages.length,
              })
            }}
          </span>
          <div class="site-view__toolbar-actions">
            <UiButton
              variant="plain"
              icon="visibility"
              :disabled="!filteredPages.length"
              @click="setVisibilityShown('included')"
            >
              {{ $t("site.includeShown") }}
            </UiButton>
            <UiButton
              variant="plain"
              icon="visibility_off"
              :disabled="!filteredPages.length"
              @click="setVisibilityShown('private')"
            >
              {{ $t("site.excludeShown") }}
            </UiButton>
          </div>
        </div>

        <div class="site-pages__defaults">
          <label class="site-view__field site-view__field--inline">
            <span>{{ $t("site.defaultVisibility") }}</span>
            <UiSelect
              :model-value="site.defaultVisibility"
              :options="visibilityOptions"
              :label="$t('site.defaultVisibility')"
              @update:model-value="updateSite({ defaultVisibility: $event as SiteVisibility })"
            />
          </label>
          <p class="site-view__hint">{{ $t("site.defaultVisibilityHint") }}</p>
        </div>

        <ul v-if="filteredPages.length" class="site-pages">
          <li
            v-for="page in filteredPages"
            :key="page.id"
            class="site-page"
            :class="{ 'site-page--included': visibilityOf(page) !== 'private' }"
          >
            <div class="site-page__main">
              <UiCheckbox
                class="site-page__include"
                :model-value="visibilityOf(page) !== 'private'"
                @update:model-value="toggleIncluded(page, $event)"
              >
                <span class="site-page__identity">
                  <span class="site-page__title">{{ pageSettings(page).title || page.title }}</span>
                  <span class="site-page__path">{{ page.path }}</span>
                </span>
              </UiCheckbox>
              <div class="site-page__controls">
                <UiSelect
                  :model-value="visibilityOf(page)"
                  :options="visibilityOptions"
                  :label="$t('site.pageVisibility', { title: page.title })"
                  @update:model-value="setVisibility(page, $event as SiteVisibility)"
                />
                <UiIconButton
                  icon="open_in_new"
                  :label="$t('site.openPage')"
                  :size="20"
                  @click="emit('openPage', page.id)"
                />
              </div>
            </div>
            <UiCollapsible
              v-if="visibilityOf(page) !== 'private'"
              class="site-page__advanced"
              :label="$t('site.pageOptions')"
            >
              <div class="site-page__grid">
                <label class="site-view__field">
                  <span>{{ $t("site.customPath") }}</span>
                  <UiTextField
                    :value="pageSettings(page).slug ?? ''"
                    :placeholder="page.path.replace(/\.typ$/, '')"
                    @change="updatePage(page, { slug: ($event.target as HTMLInputElement).value })"
                  />
                </label>
                <label class="site-view__field">
                  <span>{{ $t("site.description") }}</span>
                  <UiTextField
                    :value="pageSettings(page).description ?? ''"
                    @change="
                      updatePage(page, { description: ($event.target as HTMLInputElement).value })
                    "
                  />
                </label>
                <label class="site-view__field">
                  <span>{{ $t("site.pageTitle") }}</span>
                  <UiTextField
                    :value="pageSettings(page).title ?? ''"
                    :placeholder="page.title"
                    @change="updatePage(page, { title: ($event.target as HTMLInputElement).value })"
                  />
                </label>
                <label class="site-view__field">
                  <span>{{ $t("site.pageTags") }}</span>
                  <UiTagsInput
                    :model-value="pageSettings(page).tags ?? page.tags"
                    :label="$t('site.pageTags')"
                    @update:model-value="updatePage(page, { tags: $event })"
                  />
                </label>
              </div>
              <div class="site-page__checks">
                <UiCheckbox
                  class="site-page__check"
                  :model-value="pageSettings(page).hiddenFromNav ?? false"
                  :label="$t('site.hideFromNav')"
                  @update:model-value="updatePage(page, { hiddenFromNav: $event })"
                />
                <UiCheckbox
                  class="site-page__check"
                  :model-value="pageSettings(page).includeInSearch ?? true"
                  :label="$t('site.includeInSearch')"
                  @update:model-value="updatePage(page, { includeInSearch: $event })"
                />
                <UiCheckbox
                  class="site-page__check"
                  :model-value="pageSettings(page).includeInFeed ?? true"
                  :label="$t('site.includeInFeed')"
                  @update:model-value="updatePage(page, { includeInFeed: $event })"
                />
              </div>
            </UiCollapsible>
          </li>
        </ul>
        <p v-else class="site-pages__empty">{{ $t("site.noPagesMatch") }}</p>
      </div>

      <div v-else-if="tab === 'design'" class="site-view__panel">
        <div class="site-view__grid">
          <label class="site-view__field">
            <span>{{ $t("site.name") }}</span>
            <UiTextField
              :value="site.name"
              :placeholder="settings.name"
              @change="updateSite({ name: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="site-view__field">
            <span>{{ $t("site.slug") }}</span>
            <UiTextField
              :value="site.slug"
              :disabled="Boolean(site.wisp.lastDeploy)"
              :placeholder="$t('site.slugPlaceholder')"
              @change="updateSite({ slug: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="site-view__field site-view__field--wide">
            <span>{{ $t("site.description") }}</span>
            <UiTextField
              :value="site.description"
              :placeholder="$t('site.descriptionPlaceholder')"
              @change="updateSite({ description: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="site-view__field">
            <span>{{ $t("site.homePage") }}</span>
            <UiSelect
              :model-value="site.homePageId ?? GENERATED_HOME"
              :options="homeOptions"
              :label="$t('site.homePage')"
              @update:model-value="
                updateSite({ homePageId: $event === GENERATED_HOME ? null : $event })
              "
            />
          </label>
          <label class="site-view__field">
            <span>{{ $t("site.theme") }}</span>
            <UiSelect
              :model-value="site.theme"
              :options="themeOptions"
              :label="$t('site.theme')"
              @update:model-value="updateSite({ theme: $event as SiteSettings['theme'] })"
            />
          </label>
          <label class="site-view__field">
            <span>{{ $t("site.navigation") }}</span>
            <UiSelect
              :model-value="site.navigation"
              :options="navigationOptions"
              :label="$t('site.navigation')"
              @update:model-value="updateSite({ navigation: $event as SiteSettings['navigation'] })"
            />
          </label>
        </div>
        <p v-if="site.wisp.lastDeploy" class="site-view__hint">{{ $t("site.slugChangeHint") }}</p>

        <div class="site-view__switches">
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.showSearch") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.showSearchHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.showSearch"
              :aria-label="$t('site.showSearch')"
              @update:model-value="updateSite({ showSearch: $event })"
            />
          </div>
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.showToc") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.showTocHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.showToc"
              :aria-label="$t('site.showToc')"
              @update:model-value="updateSite({ showToc: $event })"
            />
          </div>
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.showDates") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.showDatesHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.showDates"
              :aria-label="$t('site.showDates')"
              @update:model-value="updateSite({ showDates: $event })"
            />
          </div>
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.includeSitemap") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.includeSitemapHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.includeSitemap"
              :aria-label="$t('site.includeSitemap')"
              @update:model-value="updateSite({ includeSitemap: $event })"
            />
          </div>
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.includeFeed") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.includeFeedHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.includeFeed"
              :aria-label="$t('site.includeFeed')"
              @update:model-value="updateSite({ includeFeed: $event })"
            />
          </div>
          <div class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.standardEnabled") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.standardEnabledHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.standard.enabled"
              :aria-label="$t('site.standardEnabled')"
              @update:model-value="updateStandard({ enabled: $event })"
            />
          </div>
          <div v-if="site.standard.enabled" class="site-switch-card">
            <div class="site-switch-card__copy">
              <span class="site-switch-card__label">{{ $t("site.showInDiscover") }}</span>
              <span class="site-switch-card__hint">{{ $t("site.showInDiscoverHint") }}</span>
            </div>
            <UiSwitch
              :model-value="site.standard.showInDiscover"
              :aria-label="$t('site.showInDiscover')"
              @update:model-value="updateStandard({ showInDiscover: $event })"
            />
          </div>
        </div>

        <UiCollapsible class="site-view__advanced" :label="$t('site.advanced')">
          <div class="site-view__grid">
            <label class="site-view__field">
              <span>{{ $t("site.serviceUrl") }}</span>
              <UiTextField
                :value="site.wisp.serviceUrl"
                placeholder="https://wisp.place"
                @change="updateWisp({ serviceUrl: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="site-view__field">
              <span>{{ $t("site.serviceDid") }}</span>
              <UiTextField
                :value="site.wisp.serviceDid"
                placeholder="did:web:wisp.place"
                @change="updateWisp({ serviceDid: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </div>
        </UiCollapsible>
      </div>

      <div v-else-if="tab === 'domain'" class="site-view__panel">
        <section class="site-domain-card site-domain-card--address">
          <div class="site-domain-card__head">
            <span class="site-domain-card__icon"><MsIcon name="link" :size="22" /></span>
            <div class="site-domain-card__copy">
              <h2>{{ $t("site.sharedUrl") }}</h2>
              <p class="site-view__hint">{{ $t("site.sharedUrlHint") }}</p>
            </div>
          </div>
          <div class="site-view__copy-row">
            <code>{{ sharedUrl || $t("site.notPublished") }}</code>
            <UiButton v-if="sharedUrl" variant="plain" icon="content_copy" @click="copy(sharedUrl)">
              {{ $t("site.copy") }}
            </UiButton>
            <UiButton
              v-if="openSiteUrl"
              variant="plain"
              icon="open_in_new"
              @click="openExternal(openSiteUrl)"
            >
              {{ $t("site.openSite") }}
            </UiButton>
          </div>
        </section>

        <section class="site-domain-card">
          <div class="site-domain-card__head">
            <span class="site-domain-card__icon"><MsIcon name="dns" :size="22" /></span>
            <div class="site-domain-card__copy">
              <h2>{{ $t("site.wispSubdomain") }}</h2>
              <p class="site-view__hint">{{ $t("site.wispSubdomainHint") }}</p>
            </div>
            <span
              v-if="site.wisp.subdomain && !site.wisp.customDomain"
              class="site-domain__status"
              :class="`site-domain__status--${site.wisp.domainStatus}`"
            >
              {{ domainStatusLabel }}
            </span>
          </div>
          <div v-if="site.wisp.subdomain" class="site-domain__record">
            <div class="site-view__copy-row">
              <code>{{ site.wisp.subdomain }}.wisp.place</code>
              <UiIconButton
                icon="content_copy"
                :label="$t('site.copy')"
                :size="20"
                @click="copy(`${site.wisp.subdomain}.wisp.place`)"
              />
              <UiButton
                v-if="!site.wisp.customDomain"
                variant="plain"
                icon="refresh"
                :disabled="domainBusy"
                @click="refreshDomain"
              >
                {{ $t("site.checkDomain") }}
              </UiButton>
              <UiButton
                variant="plain"
                icon="link_off"
                :disabled="domainBusy"
                @click="askRelease('subdomain')"
              >
                {{ $t("site.release") }}
              </UiButton>
            </div>
          </div>
          <div v-else class="site-view__inline-form">
            <UiTextField
              v-model="subdomainInput"
              :label="$t('site.wispSubdomain')"
              placeholder="notes"
              autocapitalize="none"
              spellcheck="false"
            />
            <span class="site-domain__suffix">.wisp.place</span>
            <UiButton
              variant="primary"
              :disabled="domainBusy || !atprotoStatus.signedIn || !publishingReady"
              @click="claimSubdomain"
            >
              {{ $t("site.claimSubdomain") }}
            </UiButton>
          </div>
        </section>

        <section class="site-domain-card">
          <div class="site-domain-card__head">
            <span class="site-domain-card__icon"><MsIcon name="language" :size="22" /></span>
            <div class="site-domain-card__copy">
              <h2>{{ $t("site.customDomain") }}</h2>
              <p class="site-view__hint">{{ $t("site.customDomainHint") }}</p>
            </div>
            <span
              v-if="site.wisp.customDomain"
              class="site-domain__status"
              :class="`site-domain__status--${site.wisp.domainStatus}`"
            >
              {{ domainStatusLabel }}
            </span>
          </div>

          <div v-if="!site.wisp.customDomain" class="site-domain__claim">
            <div class="site-view__inline-form">
              <UiTextField
                v-model="customDomainInput"
                :label="$t('site.customDomain')"
                placeholder="notes.example.com"
                autocapitalize="none"
                spellcheck="false"
              />
              <UiButton
                variant="primary"
                :disabled="domainBusy || !atprotoStatus.signedIn || !publishingReady"
                @click="claimCustomDomain"
              >
                {{ $t("site.claimCustomDomain") }}
              </UiButton>
            </div>
            <p class="site-view__hint">{{ $t("site.customDomainSteps") }}</p>
          </div>

          <template v-else>
            <div class="site-domain__steps">
              <div
                v-for="(step, index) in customDomainSteps"
                :key="step.label"
                class="site-domain__step"
                :class="`site-domain__step--${step.state}`"
              >
                <span class="site-domain__step-mark">
                  <MsIcon v-if="step.state === 'done'" name="check" :size="16" />
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <span>{{ step.label }}</span>
              </div>
            </div>

            <div class="site-view__copy-row">
              <code>{{ site.wisp.customDomain }}</code>
              <UiIconButton
                icon="content_copy"
                :label="$t('site.copy')"
                :size="20"
                @click="copy(site.wisp.customDomain)"
              />
              <UiButton
                v-if="deployedOnDomain"
                variant="plain"
                icon="open_in_new"
                @click="openExternal(`https://${site.wisp.customDomain}`)"
              >
                {{ $t("site.openSite") }}
              </UiButton>
            </div>

            <div
              v-if="domainInfo && site.wisp.domainStatus !== 'verified'"
              class="site-domain__dns"
            >
              <div class="site-domain__dns-head">
                <h3>{{ $t("site.dnsRecords") }}</h3>
                <p>{{ $t("site.dnsInstructions") }}</p>
              </div>
              <div class="site-domain__dns-row">
                <span>TXT</span>
                <code>{{ domainInfo.txtName }}</code>
                <UiIconButton
                  icon="content_copy"
                  :label="$t('site.copy')"
                  :size="20"
                  @click="copy(domainInfo.txtName)"
                />
              </div>
              <div class="site-domain__dns-row">
                <span>TXT</span>
                <code>{{ domainInfo.txtValue }}</code>
                <UiIconButton
                  icon="content_copy"
                  :label="$t('site.copy')"
                  :size="20"
                  @click="copy(domainInfo.txtValue)"
                />
              </div>
              <div v-if="domainInfo.cnameTarget" class="site-domain__dns-row">
                <span>CNAME</span>
                <code>{{ domainInfo.cnameTarget }}</code>
                <UiIconButton
                  icon="content_copy"
                  :label="$t('site.copy')"
                  :size="20"
                  @click="copy(domainInfo.cnameTarget)"
                />
              </div>
            </div>

            <p v-if="site.wisp.domainStatus === 'pending'" class="site-view__hint">
              {{ $t("site.domainPendingHint") }}
            </p>
            <p
              v-if="site.wisp.domainStatus === 'verified' && !deployedOnDomain"
              class="site-view__hint"
            >
              {{ $t("site.domainVerifiedHint") }}
            </p>
            <p
              v-if="site.wisp.domainStatus === 'verified' && publishBlockReason"
              class="site-view__hint"
            >
              {{ publishBlockReason }}
            </p>

            <div class="site-view__toolbar-actions">
              <UiButton
                variant="plain"
                icon="refresh"
                :disabled="domainBusy"
                @click="refreshDomain"
              >
                {{ $t("site.checkDomain") }}
              </UiButton>
              <UiButton
                v-if="site.wisp.domainStatus === 'verified'"
                variant="primary"
                icon="cloud_upload"
                :disabled="publishDisabled"
                @click="publishWithDomain"
              >
                {{ deployedOnDomain ? $t("site.republish") : $t("site.publishWithDomain") }}
              </UiButton>
              <UiButton
                variant="plain"
                icon="link_off"
                :disabled="domainBusy"
                @click="askRelease('custom')"
              >
                {{ $t("site.release") }}
              </UiButton>
            </div>
          </template>
        </section>
        <p v-if="domainError" class="site-view__error" role="alert">{{ domainError }}</p>
      </div>

      <div v-else class="site-view__panel">
        <section
          class="site-selection-card"
          :class="{ 'site-selection-card--empty': !includedCount }"
        >
          <div class="site-selection-card__copy">
            <h2>{{ $t("site.selectedPages") }}</h2>
            <p v-if="includedCount" class="site-view__hint">
              {{ $t("site.publishSummary", { pages: includedCount, public: publicCount }) }}
            </p>
            <p v-else class="site-view__hint">{{ $t("site.selectPagesHint") }}</p>
            <div v-if="includedPages.length" class="site-selection-card__chips">
              <span
                v-for="page in includedPages.slice(0, 8)"
                :key="page.id"
                class="site-selection-chip"
              >
                {{ pageSettings(page).title || page.title }}
              </span>
              <span v-if="includedPages.length > 8" class="site-selection-chip">
                +{{ includedPages.length - 8 }}
              </span>
            </div>
          </div>
          <UiButton
            :variant="includedCount ? 'plain' : 'primary'"
            :icon="includedCount ? 'edit' : 'checklist'"
            @click="editSelection"
          >
            {{ includedCount ? $t("site.editSelection") : $t("site.choosePages") }}
          </UiButton>
        </section>

        <section
          class="site-publish-card site-publish-card--hero"
          :class="{ 'site-publish-card--blocked': publishDisabled }"
        >
          <div class="site-publish__hero">
            <div class="site-publish__hero-copy">
              <span class="site-publish__hero-icon"><MsIcon name="cloud_upload" :size="28" /></span>
              <div>
                <h2>{{ $t("site.publishTitle") }}</h2>
                <p class="site-view__hint">{{ $t("site.publishHeroHint") }}</p>
              </div>
            </div>
            <UiButton
              class="site-publish__cta"
              variant="primary"
              icon="cloud_upload"
              :icon-size="22"
              :disabled="publishDisabled"
              @click="onPublish"
            >
              {{ site.wisp.lastDeploy ? $t("site.republish") : $t("site.publish") }}
            </UiButton>
          </div>

          <p v-if="publishBlockReason" class="site-publish__blocked">{{ publishBlockReason }}</p>
          <p v-if="site.wisp.lastDeploy" class="site-view__hint">
            {{
              $t("site.lastPublished", {
                date: new Date(site.wisp.lastDeploy.deployedAt).toLocaleString(),
                files: site.wisp.lastDeploy.fileCount,
              })
            }}
          </p>

          <div v-if="progress" class="site-publish__progress">
            <span>{{ progress.message }}</span>
            <span v-if="progress.total">{{ progress.done }}/{{ progress.total }}</span>
            <div v-if="progressPercent !== null" class="site-publish__bar">
              <span :style="{ width: `${progressPercent}%` }" />
            </div>
          </div>

          <p v-if="resultNote" class="site-view__note">{{ resultNote }}</p>
          <p v-if="error" class="site-view__error">{{ error }}</p>

          <div class="site-publish__actions">
            <UiButton variant="plain" icon="preview" :disabled="busy" @click="openPreview">
              {{ $t("site.preview") }}
            </UiButton>
            <UiButton variant="plain" icon="download" :disabled="busy" @click="downloadSite">
              {{ $t("site.download") }}
            </UiButton>
            <UiButton
              v-if="site.wisp.lastDeploy"
              variant="danger"
              icon="cloud_off"
              :disabled="busy"
              @click="confirmUnpublish = true"
            >
              {{ $t("site.unpublish") }}
            </UiButton>
          </div>
        </section>

        <section class="site-publish-card">
          <h2>{{ $t("site.standardTitle") }}</h2>
          <p class="site-view__hint">{{ $t("site.standardHint") }}</p>
          <p v-if="site.standard.publicationUri" class="site-view__copy-row">
            <code>{{ site.standard.publicationUri }}</code>
            <UiIconButton
              icon="content_copy"
              :label="$t('site.copy')"
              :size="20"
              @click="copy(site.standard.publicationUri)"
            />
          </p>
        </section>
      </div>
    </div>

    <div v-if="tab === 'pages' && includedCount" class="site-pages__footer">
      <div class="site-pages__footer-inner">
        <span class="site-view__count">
          {{ $t("site.publishSummary", { pages: includedCount, public: publicCount }) }}
        </span>
        <UiButton variant="primary" icon="cloud_upload" @click="reviewAndPublish">
          {{ $t("site.reviewAndPublish") }}
        </UiButton>
      </div>
    </div>

    <UiConfirmDialog
      v-model:open="confirmUnpublish"
      :title="$t('site.unpublish')"
      :description="$t('site.unpublishConfirm')"
      :confirm-label="$t('site.unpublish')"
      @confirm="onUnpublish"
    />

    <UiConfirmDialog
      v-model:open="releaseOpen"
      :title="$t('site.release')"
      :description="$t('site.releaseConfirm')"
      :confirm-label="$t('site.release')"
      @confirm="confirmRelease"
    />

    <UiDialog v-model:open="previewOpen" class="site-preview-dialog" :title="$t('site.preview')">
      <iframe class="site-preview-frame" :srcdoc="previewHtml" sandbox="" title="Site preview" />
    </UiDialog>
  </section>
</template>

<style>
.site-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  /* padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-2) + var(--safe-right)) 0
    calc(var(--space-2) + var(--safe-left)); */
}

.site-view__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  overflow: auto;
  /* padding-bottom: calc(var(--space-10) + var(--safe-bottom)); */
  padding: var(--space-2);
}

.site-view__header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  max-width: 64rem;
  padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-2) + var(--safe-right)) 0
    calc(var(--space-2) + var(--safe-left));
}

.site-view__heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1 1 auto;
}

.site-view__title-group {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.site-view__title-copy {
  flex: 1;
  min-width: 0;
}

.site-view__title {
  margin: 0;
  font-size: var(--text-2xl);
}

.site-view__sub {
  max-width: 100%;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-view__actions,
.site-view__toolbar,
.site-view__toolbar-actions,
.site-view__copy-row,
.site-view__inline-form,
.site-publish__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.site-view__actions {
  flex: none;
}

.site-view__tabs {
  display: flex;
  gap: var(--space-1);
  width: 100%;
  max-width: 64rem;
  padding: 0 var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.site-view__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  padding: var(--space-2) var(--space-3);
  font: inherit;
  font-size: var(--text-sm);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.site-view__tab-count {
  min-width: 1.25rem;
  padding: 0 var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--text-2xs);
  line-height: 1.25rem;
  text-align: center;
  background: var(--color-surface-2);
  border-radius: 999px;
}

.site-view__tab--active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

.site-view__tab--active .site-view__tab-count {
  color: var(--color-on-accent);
  background: var(--color-accent);
}

.site-view__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 64rem;
  margin: 0 auto;
}

.site-view__toolbar {
  justify-content: space-between;
}

.site-view__count,
.site-view__hint {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

.site-view__note,
.site-view__error {
  max-width: 64rem;
  margin: 0 auto var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.site-view__note {
  background: var(--color-accent-soft);
  color: var(--color-text);
}

.site-view__error {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  overflow-wrap: anywhere;
}

.site-signin {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  max-width: 64rem;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.site-signin__intro {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}

.site-signin__icon {
  display: inline-flex;
  flex: none;
  color: var(--color-accent);
}

.site-signin__intro h2 {
  margin: 0;
  font-size: var(--text-md);
}

.site-signin__intro p {
  margin: 2px 0 0;
  max-width: 40rem;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.site-signin .atproto-signin {
  flex: 0 1 26rem;
}

.site-view__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
  min-width: 0;
}

.site-view__field--inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.site-view__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.site-view__field--wide {
  grid-column: 1 / -1;
}

.site-view__switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.site-switch-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.site-switch-card__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.site-switch-card__label {
  font-size: var(--text-sm);
  font-weight: 550;
}

.site-switch-card__hint {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}

.site-switch-card .ui-switch {
  flex: none;
  margin-top: 1px;
}

.site-page__check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.site-pages__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.site-pages__search {
  flex: 1 1 14rem;
}

.site-pages__filters {
  display: flex;
  gap: var(--space-0-5);
  flex-wrap: wrap;
}

.site-pages__filter {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.site-pages__filter span {
  color: inherit;
  font-size: var(--text-2xs);
  opacity: 0.8;
}

.site-pages__filter:hover {
  background: var(--color-surface-2);
}

.site-pages__filter--active {
  color: var(--color-text);
  background: var(--color-surface);
  border-color: var(--color-border);
}

.site-pages__bulk {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.site-pages__defaults {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--color-surface-2);
  border-radius: var(--radius-md);
}

.site-pages__empty {
  margin: 0;
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

.site-pages__footer {
  flex: none;
  padding: var(--space-2) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-2) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
  background: var(--color-surface-2);
  border-top: 1px solid var(--color-border);
}

.site-pages__footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  max-width: 64rem;
  margin: 0 auto;
}

.site-view__advanced,
.site-page__advanced {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.site-page__advanced .ui-collapsible__trigger {
  width: auto;
  justify-content: flex-start;
  gap: var(--space-1);
  padding-top: var(--space-1);
}

.site-page__advanced .ui-collapsible__content {
  padding-top: var(--space-2);
}

.site-view__advanced .ui-collapsible__content {
  padding-top: var(--space-3);
}

.site-pages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.site-page {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
}

.site-page--included {
  border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
}

.site-page__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.site-page__include {
  flex: 1;
  min-width: 0;
  align-items: flex-start;
}

.site-page__include .ui-checkbox__box {
  margin-top: 2px;
}

.site-page__include .ui-checkbox__label {
  flex: 1;
  min-width: 0;
}

.site-page__identity {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.site-page__title {
  font-size: var(--text-sm);
  font-weight: 550;
}

.site-page__path {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.site-page__controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.site-page__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-2) 0;
}

.site-page__checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-1);
}

.site-domain-card,
.site-publish-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.site-domain-card--address {
  border-color: color-mix(in srgb, var(--color-accent) 28%, var(--color-border));
}

.site-domain-card h2,
.site-publish-card h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.site-domain-card__head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2-5);
}

.site-domain-card__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: var(--control-md);
  height: var(--control-md);
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
}

.site-domain-card__copy {
  flex: 1;
  min-width: 0;
}

.site-domain-card__head .site-domain__status {
  flex: none;
  margin-top: 2px;
}

.site-view__copy-row {
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
  padding: var(--space-1-5) var(--space-2);
  overflow-wrap: anywhere;
}

.site-view__copy-row code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.site-view__copy-row span {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.site-view__inline-form {
  flex-wrap: nowrap;
}

.site-view__inline-form .ui-text-field {
  flex: 1;
  min-width: 0;
}

.site-domain__suffix {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.site-domain__status {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 1px var(--space-1-5);
}

.site-domain__status--verified {
  color: var(--color-ok);
  background: var(--color-ok-soft);
  border-color: color-mix(in srgb, var(--color-ok) 30%, var(--color-border));
}

.site-domain__status--pending {
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-border));
}

.site-domain__status--error {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
}

.site-domain__record {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.site-domain__claim {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.site-domain__steps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.site-domain__step {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
}

.site-domain__step-mark {
  display: inline-grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  font-size: var(--text-2xs);
  border: 1px solid currentColor;
  border-radius: 50%;
}

.site-domain__step--done {
  color: var(--color-ok);
}

.site-domain__step--current {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.site-domain__dns {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.site-domain__dns-head h3 {
  margin: 0;
  font-size: var(--text-sm);
}

.site-domain__dns-head p {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.site-domain__dns-row {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.site-domain__dns-row span {
  color: var(--color-text-secondary);
  font-size: var(--text-2xs);
  font-weight: 600;
}

.site-domain__dns-row code {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.site-selection-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.site-selection-card--empty {
  border-style: dashed;
}

.site-selection-card__copy {
  min-width: 0;
}

.site-selection-card__copy h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-md);
}

.site-selection-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.site-selection-chip {
  max-width: 16rem;
  padding: 1px var(--space-1-5);
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-surface-2);
  border-radius: 999px;
}

.site-publish-card--hero {
  gap: var(--space-3);
}

.site-publish-card--blocked {
  border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
}

.site-publish__hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.site-publish__hero-copy {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.site-publish__hero-copy > div {
  min-width: 0;
}

.site-publish__hero-icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: var(--control-lg);
  height: var(--control-lg);
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-md);
}

.site-publish__hero p {
  margin-top: 2px;
}

.site-publish__blocked {
  margin: 0;
  color: var(--color-warning);
  font-size: var(--text-sm);
}

.site-publish__cta {
  flex: none;
  justify-content: center;
  min-width: 12rem;
  min-height: var(--control-lg);
  padding-inline: var(--space-6);
  font-weight: 600;
}

.site-publish__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.site-publish__bar {
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  border-radius: 999px;
}

.site-publish__bar span {
  display: block;
  height: 100%;
  background: var(--color-accent);
  border-radius: inherit;
  transition: width var(--motion-base);
}

.site-publish__actions {
  margin-top: var(--space-1);
}

.dialog.site-preview-dialog {
  width: min(980px, calc(100vw - var(--space-8)));
}

.site-preview-frame {
  width: 100%;
  height: min(70vh, 720px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
}

@media (max-width: 48rem) {
  .site-view__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .site-view__heading {
    flex: 1 1 0;
    min-width: 0;
  }

  .site-view__actions {
    order: 3;
    width: 100%;
    justify-content: flex-start;
  }

  .site-view__close {
    order: 2;
    flex: none;
    margin-left: auto;
  }

  .site-signin {
    align-items: stretch;
    flex-direction: column;
  }

  .site-signin .atproto-signin {
    flex: 1 1 auto;
  }

  .site-page__main {
    align-items: flex-start;
    flex-direction: column;
  }

  .site-page__controls {
    width: 100%;
    justify-content: flex-end;
  }

  .site-view__grid,
  .site-page__grid,
  .site-view__switches {
    grid-template-columns: minmax(0, 1fr);
  }

  .site-view__inline-form {
    flex-wrap: wrap;
  }

  .site-view__inline-form .ui-text-field {
    flex-basis: 100%;
  }

  .site-selection-card {
    flex-direction: column;
  }

  .site-domain-card__head {
    flex-wrap: wrap;
  }

  .site-domain-card__head .site-domain__status {
    margin-left: calc(var(--control-md) + var(--space-2-5));
  }

  .site-domain__dns-row {
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
  }

  .site-publish__hero {
    align-items: stretch;
    flex-direction: column;
  }

  .site-publish__hero-copy {
    align-items: flex-start;
  }

  .site-publish__cta {
    align-self: stretch;
    justify-content: center;
  }

  .site-pages__footer-inner {
    align-items: stretch;
    flex-direction: column;
  }

  .site-pages__footer-inner .button {
    justify-content: center;
  }
}
</style>
