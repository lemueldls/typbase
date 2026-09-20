<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { InstalledPackage } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import {
  PACKAGE_NAMESPACE,
  fetchPackageBytes,
  highlightSegments,
  latestVersion,
  loadPackageIndex,
  samePackage,
  searchPackages,
  specString,
  type PackageEntry,
} from "~/lib/packages";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();
const { dataRevision } = useWorkspace();

const entries = shallowRef<PackageEntry[]>([]);
const loading = ref(false);
const indexError = ref<string>();
const actionError = ref<string>();
const query = ref("");
const installedOnly = ref(false);
const sort = ref<"relevance" | "name" | "updated">("relevance");
const sortOptions = computed(() => [
  { value: "relevance" as const, label: t("packages.sortRelevance") },
  { value: "name" as const, label: t("packages.sortName") },
  { value: "updated" as const, label: t("packages.sortUpdated") },
]);
const busy = ref<string>();
const copied = ref<string>();
const selected = reactive<Record<string, string>>({});
const installed = ref<InstalledPackage[]>([]);

/** Settings updates do not notify the sidebar, so re-read the list when the
 *  dialog opens and after every install or removal. */
function refreshInstalled() {
  installed.value = props.store.getSettings().installedPackages;
}

const needle = computed(() => query.value.trim().toLowerCase());

const filtered = computed(() => {
  let list = searchPackages(entries.value, query.value);

  if (installedOnly.value) {
    list = list.filter((entry) => installed.value.some((pkg) => pkg.name === entry.name));
  }

  if (sort.value === "name") {
    list = [...list].sort((left, right) => left.name.localeCompare(right.name));
  } else if (sort.value === "updated") {
    list = [...list].sort(
      (left, right) =>
        (latestVersion(right)?.updatedAt ?? 0) - (latestVersion(left)?.updatedAt ?? 0) ||
        left.name.localeCompare(right.name),
    );
  }

  return list;
});

// The index has a few thousand rows; render only what the dialog shows. Rows
// stack their actions under the text on narrow screens, so they need more
// height there.
const compact = useMediaQuery("(max-width: 640px)");
const { list, containerProps, wrapperProps } = useVirtualList(filtered, {
  itemHeight: () => (compact.value ? 163 : 120),
  overscan: 6,
});

watch([open, dataRevision], ([value]) => {
  if (!value) return;

  refreshInstalled();
  if (entries.value.length > 0 || loading.value) return;

  void loadIndex(false);
});

async function loadIndex(force: boolean) {
  loading.value = true;
  indexError.value = undefined;

  try {
    entries.value = await loadPackageIndex(force);
    // Version picks from the previous index may no longer exist.
    for (const key of Object.keys(selected)) delete selected[key];
  } catch (cause) {
    indexError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function versionFor(entry: PackageEntry): string {
  return selected[entry.name] ?? latestVersion(entry)?.version ?? "";
}

function onVersionChange(entry: PackageEntry, value: string) {
  if (value) selected[entry.name] = value;
}

function actionIcon(entry: PackageEntry): MaterialSymbol {
  const version = versionFor(entry);
  if (isInstalled(entry.name, version)) return "delete";
  if (version === latestVersion(entry)?.version && hasUpdate(entry)) return "update";

  return "download";
}

function specFor(entry: PackageEntry, version: string): InstalledPackage {
  return { namespace: PACKAGE_NAMESPACE, name: entry.name, version };
}

function rowKey(entry: PackageEntry): string {
  return specString(specFor(entry, versionFor(entry)));
}

function installedFor(name: string): InstalledPackage[] {
  return installed.value.filter((pkg) => pkg.name === name);
}

function isInstalled(name: string, version: string): boolean {
  return installedFor(name).some((pkg) => pkg.version === version);
}

/** True when an older version is installed and the newest one is not. */
function hasUpdate(entry: PackageEntry): boolean {
  const newest = latestVersion(entry)?.version;
  if (!newest) return false;

  const versions = installedFor(entry.name);
  return versions.length > 0 && !versions.some((pkg) => pkg.version === newest);
}

function actionLabel(entry: PackageEntry): string {
  const version = versionFor(entry);
  if (busy.value === specString(specFor(entry, version))) return t("packages.working");
  if (isInstalled(entry.name, version)) return t("packages.remove");
  if (version === latestVersion(entry)?.version && hasUpdate(entry)) return t("packages.update");

  return t("packages.install");
}

function updatedLabel(entry: PackageEntry): string {
  const updatedAt = latestVersion(entry)?.updatedAt;
  if (!updatedAt) return "";

  const days = Math.max(0, Date.now() / 1000 - updatedAt) / 86400;
  if (days < 1) return t("packages.updatedToday");
  if (days < 2) return t("packages.updatedYesterday");
  if (days < 30) return t("packages.updatedDays", { count: Math.floor(days) });
  if (days < 365) return t("packages.updatedMonths", { count: Math.floor(days / 30) });

  return t("packages.updatedYears", { count: Math.floor(days / 365) });
}

async function install(spec: InstalledPackage) {
  busy.value = specString(spec);
  actionError.value = undefined;

  try {
    const bytes = await fetchPackageBytes(spec);
    const typstState = await useTypst();
    typstState.installPackage(specString(spec), bytes);

    if (!isInstalled(spec.name, spec.version)) {
      props.store.updateSettings({
        installedPackages: [...props.store.getSettings().installedPackages, spec],
      });
      refreshInstalled();
    }

    // Open editors recompile on the revision bump, so a just-installed
    // package shows up without a manual edit.
    bumpRenderRevision();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = undefined;
  }
}

async function remove(spec: InstalledPackage) {
  busy.value = specString(spec);
  actionError.value = undefined;

  try {
    const typstState = await useTypst();
    typstState.removePackage(specString(spec));
    props.store.updateSettings({
      installedPackages: props.store
        .getSettings()
        .installedPackages.filter((pkg) => !samePackage(pkg, spec)),
    });
    refreshInstalled();
    bumpRenderRevision();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = undefined;
  }
}

async function toggle(entry: PackageEntry) {
  const spec = specFor(entry, versionFor(entry));
  if (isInstalled(spec.name, spec.version)) await remove(spec);
  else await install(spec);
}

async function copySpec(entry: PackageEntry) {
  const spec = specString(specFor(entry, versionFor(entry)));

  try {
    await navigator.clipboard.writeText(spec);
  } catch {
    // Clipboard API is missing outside secure contexts; the textarea trick
    // still works in the Tauri webview.
    const area = document.createElement("textarea");
    area.value = spec;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  copied.value = entry.name;
  window.setTimeout(() => {
    if (copied.value === entry.name) copied.value = undefined;
  }, 1200);
}

function openRepository(entry: PackageEntry) {
  const url = latestVersion(entry)?.repository;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="package-dialog"
    :title="$t('packages.title')"
    :description="$t('packages.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <div class="package-browser__toolbar">
      <UiTextField
        v-model="query"
        class="package-browser__search"
        type="search"
        :placeholder="$t('packages.search')"
      />
      <UiCheckbox v-model="installedOnly" :label="$t('packages.installedOnly')" />
      <UiSelect v-model="sort" :options="sortOptions" :label="$t('packages.sort')" />
      <UiIconButton
        icon="refresh"
        :size="20"
        :label="$t('packages.refresh')"
        :disabled="loading"
        @click="loadIndex(true)"
      />
    </div>

    <p v-if="!indexError && entries.length > 0" class="package-browser__count">
      {{ $t("packages.showing", { shown: filtered.length, total: entries.length }) }}
    </p>

    <p v-if="actionError || (indexError && entries.length > 0)" class="package-browser__banner">
      {{ actionError ?? indexError }}
    </p>

    <div v-if="loading && entries.length === 0" class="package-browser__list">
      <UiSkeleton
        v-for="index in 6"
        :key="index"
        class="package-browser__skeleton"
        :height="compact ? '163px' : '120px'"
        radius="0"
      />
    </div>

    <div v-else-if="indexError && entries.length === 0" class="package-browser__state">
      <p class="package-browser__error">{{ indexError }}</p>
      <UiButton variant="ghost" size="small" @click="loadIndex(true)">
        {{ $t("packages.retry") }}
      </UiButton>
    </div>

    <div v-else-if="filtered.length === 0" class="package-browser__state">
      <p class="package-browser__note">{{ $t("packages.empty") }}</p>
      <UiButton v-if="query" variant="ghost" size="small" @click="query = ''">
        {{ $t("packages.clear") }}
      </UiButton>
    </div>

    <div v-else v-bind="containerProps" class="package-browser__list">
      <div v-bind="wrapperProps">
        <div v-for="{ data: entry } in list" :key="entry.name" class="package-browser__row">
          <div class="package-browser__info">
            <span class="package-browser__title">
              <span class="package-browser__name">
                <template
                  v-for="(part, index) in highlightSegments(entry.name, needle)"
                  :key="index"
                >
                  <mark v-if="part.match">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="hasUpdate(entry)" class="package-browser__badge">
                {{ $t("packages.updateAvailable") }}
              </span>
              <!-- <span
                v-for="pkg in installedFor(entry.name)"
                :key="specString(pkg)"
                class="package-browser__chip"
              >
                {{ pkg.version }}
                <UiIconButton
                  icon="close"
                  :size="12"
                  variant="ghost"
                  :label="$t('packages.removeVersion', { version: pkg.version })"
                  :disabled="busy === specString(pkg)"
                  @click="remove(pkg)"
                />
              </span> -->
              <UiSelect
                class="package-browser__select"
                size="small"
                :model-value="versionFor(entry)"
                :options="
                  entry.versions.map((version) => ({
                    value: version.version,
                    label: version.version,
                  }))
                "
                :label="$t('packages.version')"
                :disabled="busy === rowKey(entry)"
                @update:model-value="(value: string) => onVersionChange(entry, value)"
              />
            </span>

            <span class="package-browser__description">
              <template
                v-for="(part, index) in highlightSegments(entry.description, needle)"
                :key="index"
              >
                <mark v-if="part.match">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>

            <span class="package-browser__meta">
              <span>v{{ latestVersion(entry)?.version }}</span>
              <template v-if="latestVersion(entry)?.license">
                <span>·</span>
                <span>{{ latestVersion(entry)?.license }}</span>
              </template>
              <template v-if="updatedLabel(entry)">
                <span>·</span>
                <span>{{ updatedLabel(entry) }}</span>
              </template>
            </span>
          </div>

          <div class="package-browser__actions">
            <UiButton
              size="small"
              class="package-browser__action"
              :variant="isInstalled(entry.name, versionFor(entry)) ? 'plain' : 'primary'"
              :disabled="busy === rowKey(entry)"
              @click="toggle(entry)"
            >
              <span
                v-if="busy === rowKey(entry)"
                class="package-browser__spinner"
                aria-hidden="true"
              />
              <MsIcon v-else :name="actionIcon(entry)" :size="20" />
              {{ actionLabel(entry) }}
            </UiButton>

            <UiIconButton
              :icon="copied === entry.name ? 'check' : 'content_copy'"
              :size="20"
              :label="copied === entry.name ? $t('packages.copied') : $t('packages.copySpec')"
              @click="copySpec(entry)"
            />
            <UiIconButton
              v-if="latestVersion(entry)?.repository"
              icon="open_in_new"
              :size="20"
              :label="$t('packages.repository')"
              @click="openRepository(entry)"
            />
          </div>
        </div>
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.package-browser__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2-5);
  margin-bottom: var(--space-1-5);
}

.package-browser__search {
  flex: 1;
  min-width: 0;
}

.package-browser__count {
  margin: 0 0 var(--space-1-5);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.package-browser__list {
  height: min(60vh, 26rem);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.package-browser__row {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-2);
  box-sizing: border-box;
  height: 120px;
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.package-browser__info {
  display: flex;
  flex: 1 1 auto;
  height: 100%;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.package-browser__title {
  display: flex;
  align-items: start;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.package-browser__name {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  font-size: var(--text-xl);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-browser__badge {
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
  font-size: var(--text-2xs);
  font-weight: 600;
  white-space: nowrap;
}

.package-browser__description {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  flex: 1 1 auto;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.package-browser__meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.package-browser__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  flex: none;
  padding: 0 var(--space-0-5) 0 var(--space-1-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.package-browser__select {
  flex: none;
}

.package-browser__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  flex-shrink: 0;
}

.package-browser__action {
  flex: 1;
  justify-content: center;
  min-width: 6.2rem;
}

.package-browser__spinner {
  width: 0.8rem;
  height: 0.8rem;
  margin-right: var(--space-1);
  border: 2px solid var(--color-text-secondary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: package-browser-spin 0.7s linear infinite;
}

@keyframes package-browser-spin {
  to {
    transform: rotate(360deg);
  }
}

.package-browser__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
}

.package-browser__note,
.package-browser__error {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.package-browser__banner {
  margin: 0 0 var(--space-1-5);
  padding: var(--space-1-5) var(--space-2-5);
  border: 1px solid color-mix(in srgb, var(--color-danger, #b42828) 35%, transparent);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-danger, #b42828) 8%, transparent);
  color: var(--color-danger, #b42828);
  font-size: var(--text-sm);
}

.package-browser__error {
  color: var(--color-danger, #b42828);
}

.package-browser__skeleton {
  border-bottom: 1px solid var(--color-border);
}

mark {
  padding: 0;
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  color: inherit;
  border-radius: var(--radius-xs);
}

/* Narrow screens: the row stacks its actions under the text and the search
   takes its own line. Keep the heights in sync with the virtual list's
   compact itemHeight. */
@media (max-width: 640px) {
  .package-browser__row {
    height: 163px;
    flex-direction: column;
    align-items: stretch;
  }

  .package-browser__search {
    flex: 1 1 100%;
  }
}
</style>
