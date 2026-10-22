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

const tab = ref<"pages" | "design" | "domain" | "publish">("pages");
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
const publishedUrl = computed(() => site.value.wisp.lastDeploy?.url ?? "");
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

function visibilityOf(page: PageMeta): SiteVisibility {
  return site.value.pages[page.id]?.visibility ?? site.value.defaultVisibility;
}

function pageSettings(page: PageMeta): SitePageSettings {
  return site.value.pages[page.id] ?? {};
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

function includeAll(): void {
  updateSite({ defaultVisibility: "public", pages: {} });
}

function excludeAll(): void {
  updateSite({ defaultVisibility: "private", pages: {} });
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
      subdomain: label,
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
      customDomain: domain,
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

function navigateTo(url: string): void {
  window.open(url, "_blank", "noopener");
}
</script>

<template>
  <section class="site-view">
    <header class="site-view__header">
      <div class="site-view__heading">
        <slot name="nav-toggle" />
        <div class="site-view__title-group">
          <MsIcon name="public" :size="24" />
          <div class="site-view__title-copy">
            <h1 class="site-view__title">{{ $t("site.title") }}</h1>
            <p class="site-view__sub">{{ headerSub }}</p>
          </div>
        </div>
      </div>
      <div class="site-view__actions">
        <UiButton v-if="displayUrl" variant="plain" icon="content_copy" @click="copy(displayUrl)">
          {{ $t("site.copyUrl") }}
        </UiButton>
        <UiButton
          v-if="publishedUrl"
          variant="plain"
          icon="open_in_new"
          @click="openExternal(publishedUrl)"
        >
          {{ $t("site.openSite") }}
        </UiButton>
        <UiIconButton
          class="site-view__close"
          icon="close"
          :label="$t('common.close')"
          @click="emit('close')"
        />
      </div>
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
        @click="tab = entry"
      >
        {{ $t(`site.tab_${entry}`) }}
      </button>
    </div>

    <p v-if="!atprotoStatus.signedIn" class="site-view__note">
      {{ $t("site.signInHint") }}
    </p>

    <div v-if="tab === 'pages'" class="site-view__panel">
      <div class="site-view__toolbar">
        <div class="site-view__count">
          {{
            $t("site.pageSummary", {
              included: includedCount,
              public: publicCount,
              total: pages.length,
            })
          }}
        </div>
        <div class="site-view__toolbar-actions">
          <UiButton variant="plain" icon="visibility" @click="includeAll">
            {{ $t("site.includeAll") }}
          </UiButton>
          <UiButton variant="plain" icon="visibility_off" @click="excludeAll">
            {{ $t("site.excludeAll") }}
          </UiButton>
        </div>
      </div>

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

      <ul class="site-pages">
        <li v-for="page in pages" :key="page.id" class="site-page">
          <div class="site-page__main">
            <div class="site-page__identity">
              <span class="site-page__title">{{ page.title }}</span>
              <span class="site-page__path">{{ page.path }}</span>
            </div>
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
        <UiSwitch
          class="site-switch"
          :model-value="site.showSearch"
          :label="$t('site.showSearch')"
          @update:model-value="updateSite({ showSearch: $event })"
        />
        <UiSwitch
          class="site-switch"
          :model-value="site.showToc"
          :label="$t('site.showToc')"
          @update:model-value="updateSite({ showToc: $event })"
        />
        <UiSwitch
          class="site-switch"
          :model-value="site.showDates"
          :label="$t('site.showDates')"
          @update:model-value="updateSite({ showDates: $event })"
        />
        <UiSwitch
          class="site-switch"
          :model-value="site.includeSitemap"
          :label="$t('site.includeSitemap')"
          @update:model-value="updateSite({ includeSitemap: $event })"
        />
        <UiSwitch
          class="site-switch"
          :model-value="site.includeFeed"
          :label="$t('site.includeFeed')"
          @update:model-value="updateSite({ includeFeed: $event })"
        />
        <UiSwitch
          class="site-switch"
          :model-value="site.standard.enabled"
          :label="$t('site.standardEnabled')"
          @update:model-value="updateStandard({ enabled: $event })"
        />
        <UiSwitch
          v-if="site.standard.enabled"
          class="site-switch"
          :model-value="site.standard.showInDiscover"
          :label="$t('site.showInDiscover')"
          @update:model-value="updateStandard({ showInDiscover: $event })"
        />
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
      <section class="site-domain-card">
        <h2>{{ $t("site.sharedUrl") }}</h2>
        <p class="site-view__hint">{{ $t("site.sharedUrlHint") }}</p>
        <div class="site-view__copy-row">
          <code>{{ sharedUrl || $t("site.notPublished") }}</code>
          <UiButton v-if="sharedUrl" variant="plain" icon="content_copy" @click="copy(sharedUrl)">
            {{ $t("site.copy") }}
          </UiButton>
        </div>
      </section>

      <section class="site-domain-card">
        <h2>{{ $t("site.wispSubdomain") }}</h2>
        <p class="site-view__hint">{{ $t("site.wispSubdomainHint") }}</p>
        <div v-if="site.wisp.subdomain" class="site-view__copy-row">
          <code>{{ site.wisp.subdomain }}.wisp.place</code>
          <span class="site-domain__status">{{ site.wisp.domainStatus }}</span>
          <UiButton variant="plain" icon="refresh" :disabled="domainBusy" @click="refreshDomain">
            {{ $t("site.refresh") }}
          </UiButton>
          <UiButton
            variant="plain"
            icon="link_off"
            :disabled="domainBusy"
            @click="releaseDomain('subdomain')"
          >
            {{ $t("site.release") }}
          </UiButton>
        </div>
        <div v-else class="site-view__inline-form">
          <UiTextField
            v-model="subdomainInput"
            :label="$t('site.wispSubdomain')"
            placeholder="notes"
          />
          <span class="site-domain__suffix">.wisp.place</span>
          <UiButton
            variant="primary"
            :disabled="domainBusy || !atprotoStatus.signedIn"
            @click="claimSubdomain"
          >
            {{ $t("site.claim") }}
          </UiButton>
        </div>
      </section>

      <section class="site-domain-card">
        <h2>{{ $t("site.customDomain") }}</h2>
        <p class="site-view__hint">{{ $t("site.customDomainHint") }}</p>
        <div v-if="site.wisp.customDomain" class="site-domain__record">
          <code>{{ site.wisp.customDomain }}</code>
          <span class="site-domain__status">{{ site.wisp.domainStatus }}</span>
          <div v-if="domainInfo" class="site-domain__dns">
            <p>{{ $t("site.dnsInstructions") }}</p>
            <div class="site-view__copy-row">
              <span>TXT</span><code>{{ domainInfo.txtName }}</code
              ><UiIconButton
                icon="content_copy"
                :label="$t('site.copy')"
                :size="20"
                @click="copy(domainInfo.txtName)"
              />
            </div>
            <div class="site-view__copy-row">
              <span>TXT value</span><code>{{ domainInfo.txtValue }}</code
              ><UiIconButton
                icon="content_copy"
                :label="$t('site.copy')"
                :size="20"
                @click="copy(domainInfo.txtValue)"
              />
            </div>
            <div v-if="domainInfo.cnameTarget" class="site-view__copy-row">
              <span>CNAME</span><code>{{ domainInfo.cnameTarget }}</code
              ><UiIconButton
                icon="content_copy"
                :label="$t('site.copy')"
                :size="20"
                @click="copy(domainInfo.cnameTarget)"
              />
            </div>
          </div>
          <div class="site-view__toolbar-actions">
            <UiButton
              variant="plain"
              icon="refresh"
              :disabled="domainBusy"
              @click="refreshDomain"
              >{{ $t("site.checkDomain") }}</UiButton
            >
            <UiButton
              variant="plain"
              icon="link_off"
              :disabled="domainBusy"
              @click="releaseDomain('custom')"
              >{{ $t("site.release") }}</UiButton
            >
          </div>
        </div>
        <div v-else class="site-view__inline-form">
          <UiTextField
            v-model="customDomainInput"
            :label="$t('site.customDomain')"
            placeholder="notes.example.com"
          />
          <UiButton
            variant="primary"
            :disabled="domainBusy || !atprotoStatus.signedIn"
            @click="claimCustomDomain"
          >
            {{ $t("site.claim") }}
          </UiButton>
        </div>
      </section>
      <p v-if="domainError" class="site-view__error">{{ domainError }}</p>
      <p v-if="site.wisp.domainStatus === 'verified'" class="site-view__hint">
        {{ $t("site.domainVerifiedHint") }}
      </p>
    </div>

    <div v-else class="site-view__panel">
      <p v-if="atprotoStatus.signedIn && !publishingReady" class="site-view__note">
        {{ $t("site.scopeHint") }}
        <UiButton variant="plain" :disabled="busy" @click="reconnectForPublishing">
          {{ $t("site.reconnect") }}
        </UiButton>
      </p>
      <section class="site-publish-card">
        <div class="site-publish__summary">
          <div>
            <h2>{{ $t("site.publishTitle") }}</h2>
            <p class="site-view__hint">
              {{ $t("site.publishSummary", { pages: includedCount, public: publicCount }) }}
            </p>
          </div>
          <UiButton
            variant="primary"
            icon="cloud_upload"
            :disabled="busy || !atprotoStatus.signedIn || includedCount === 0"
            @click="onPublish"
          >
            {{ site.wisp.lastDeploy ? $t("site.republish") : $t("site.publish") }}
          </UiButton>
        </div>

        <div v-if="progress" class="site-publish__progress">
          <span>{{ progress.message }}</span>
          <span v-if="progress.total">{{ progress.done }}/{{ progress.total }}</span>
        </div>

        <p v-if="site.wisp.lastDeploy" class="site-view__hint">
          {{
            $t("site.lastPublished", {
              date: new Date(site.wisp.lastDeploy.deployedAt).toLocaleString(),
              files: site.wisp.lastDeploy.fileCount,
            })
          }}
        </p>
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

    <UiConfirmDialog
      v-model:open="confirmUnpublish"
      :title="$t('site.unpublish')"
      :description="$t('site.unpublishConfirm')"
      :confirm-label="$t('site.unpublish')"
      @confirm="onUnpublish"
    />

    <UiDialog v-model:open="previewOpen" class="site-preview-dialog" :title="$t('site.preview')">
      <iframe class="site-preview-frame" :srcdoc="previewHtml" sandbox="" title="Site preview" />
    </UiDialog>
  </section>
</template>

<style>
.site-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-10) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.site-view__header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  max-width: 64rem;
  margin: 0 auto var(--space-4);
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
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.site-view__title-copy {
  min-width: 0;
}

.site-view__title {
  margin: 0;
  font-size: var(--text-xl);
}

.site-view__sub {
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
  max-width: 64rem;
  margin: 0 auto var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.site-view__tab {
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

.site-view__tab--active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

.site-view__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
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
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-2) var(--space-4);
}

.site-switch,
.site-page__check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
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
  gap: var(--space-1);
}

.site-page {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
}

.site-page__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
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

.site-domain-card h2,
.site-publish-card h2 {
  margin: 0;
  font-size: var(--text-lg);
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

.site-domain__record {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.site-domain__dns {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2-5);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
}

.site-domain__dns p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.site-publish__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.site-publish__progress {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-2);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.site-publish__actions {
  margin-top: var(--space-3);
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
    flex-wrap: wrap;
  }

  .site-view__heading {
    flex: 1 1 100%;
  }

  .site-view__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .site-view__close {
    margin-left: auto;
  }

  .site-page__main,
  .site-publish__summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .site-view__grid,
  .site-page__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .site-view__inline-form {
    flex-wrap: wrap;
  }
}
</style>
