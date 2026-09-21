<script setup lang="ts">
import type { WorkspaceInfo } from "@typbase/typing";

const props = defineProps<{ mode: "screen" | "menu" }>();

const { workspaces, activeWorkspaceId, switching, switchWorkspace, deleteWorkspace } =
  useWorkspace();

const { t, locale } = useI18n();
function formatOpened(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(timestamp));
}

const busy = ref(false);
const error = ref("");

const newOpen = defineModel<boolean>("open", { default: false });

const dialogOpen = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editing = ref<WorkspaceInfo | null>(null);

/** Workspace queued for deletion. The target survives the dialog's close
 *  event: reka's action closes the dialog before the confirm handler runs. */
const pendingDelete = ref<WorkspaceInfo | null>(null);
const confirmOpen = ref(false);

function askDelete(info: WorkspaceInfo) {
  pendingDelete.value = info;
  confirmOpen.value = true;
}

function openCreate() {
  if (props.mode === "menu") newOpen.value = false;
  dialogMode.value = "create";
  editing.value = null;
  dialogOpen.value = true;
}

function openRename(info: WorkspaceInfo) {
  if (props.mode === "menu") newOpen.value = false;
  dialogMode.value = "edit";
  editing.value = info;
  dialogOpen.value = true;
}

async function onSwitch(id: string) {
  if (id === activeWorkspaceId.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await switchWorkspace(id);
    if (props.mode === "menu") newOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function confirmDelete() {
  const info = pendingDelete.value;
  if (!info) return;
  pendingDelete.value = null;
  confirmOpen.value = false;

  try {
    if (props.mode === "menu") newOpen.value = false;
    await deleteWorkspace(info.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function active(id: string | null): boolean {
  return id != null && id === activeWorkspaceId.value;
}

function statusFor(info: WorkspaceInfo): string {
  if (active(info.id)) return t("switcher.current");

  return t("switcher.opened", { date: formatOpened(info.lastOpenedAt) });
}
</script>

<template>
  <div v-if="mode === 'screen'" class="ws-screen">
    <header class="ws-screen__header" data-tauri-drag-region="deep">
      <h1 class="ws-screen__title">{{ $t("switcher.title") }}</h1>
      <!-- <p class="ws-screen__subtitle">{{ $t("switcher.hint") }}</p> -->
    </header>

    <ul v-if="workspaces.length" class="ws-screen__list">
      <li v-for="info in workspaces" :key="info.id">
        <WorkspaceRow
          :info="info"
          :active="active(info.id)"
          :switching="switching === info.id"
          :disabled="busy"
          :status="statusFor(info)"
          @select="onSwitch(info.id)"
          @rename="openRename(info)"
          @remove="askDelete(info)"
        />
      </li>
    </ul>
    <p v-else class="ws-screen__hint">{{ $t("switcher.noWorkspaces") }}</p>

    <UiButton variant="primary" class="ws-screen__add" :disabled="busy" @click="openCreate">
      <MsIcon name="add" :size="20" />
      {{ $t("switcher.add") }}
    </UiButton>

    <p v-if="error" class="ws-screen__error" role="alert">{{ error }}</p>
  </div>

  <template v-else>
    <PopoverRoot v-model:open="newOpen">
      <PopoverTrigger as-child>
        <slot>
          <UiIconButton icon="swap_horiz" :label="$t('switcher.switchAria')" />
        </slot>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="menu ws-menu" :side-offset="6" align="start">
          <div class="ws-menu__header">
            <span>{{ $t("switcher.heading") }}</span>
            <span class="ws-menu__count">{{ workspaces.length }}</span>
          </div>

          <ul class="ws-menu__list">
            <li v-for="info in workspaces" :key="info.id">
              <WorkspaceRow
                :info="info"
                :active="active(info.id)"
                :switching="switching === info.id"
                :disabled="busy"
                :status="statusFor(info)"
                @select="onSwitch(info.id)"
                @rename="openRename(info)"
                @remove="askDelete(info)"
              />
            </li>
          </ul>

          <div class="menu__separator" />

          <button type="button" class="menu__item ws-menu__add" @click="openCreate">
            <MsIcon name="add" :size="20" />
            {{ $t("switcher.add") }}
          </button>

          <p v-if="error" class="ws-menu__error" role="alert">{{ error }}</p>
          <!-- <p class="ws-menu__hint">{{ $t("switcher.hint") }}</p> -->
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </template>

  <WorkspaceDialog v-model:open="dialogOpen" :mode="dialogMode" :workspace="editing" />

  <UiConfirmDialog
    :open="confirmOpen"
    :title="$t('switcher.deleteTitle')"
    :description="$t('switcher.deleteConfirm', { name: pendingDelete?.name ?? '' })"
    @update:open="(value) => !value && (confirmOpen = false)"
    @confirm="confirmDelete"
  />
</template>

<style scoped>
.ws-screen {
  display: grid;
  place-content: center;
  gap: var(--space-4);
  width: min(480px, calc(100vw - var(--space-8) - var(--safe-left) - var(--safe-right)));
  margin: 0 auto;
}

.ws-screen__header {
  text-align: center;
}

.ws-screen__title {
  margin: 0 0 var(--space-1-5);
  font-size: var(--text-2xl);
}

.ws-screen__subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.ws-screen__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

/* The border and surface live on the wrapper, so the row's own hover and
   active backgrounds paint over them without a specificity fight. */
.ws-screen__list > li {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ws-screen__hint {
  color: var(--color-text-secondary);
  text-align: center;
}

.ws-screen__add {
  justify-content: center;
}

.ws-screen__error,
.ws-menu__error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-md);
}

.ws-menu {
  width: min(320px, calc(100vw - var(--space-8)));
  padding: var(--space-1-5);
}

.ws-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1-5) var(--space-2-5) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.ws-menu__count {
  font-weight: 500;
}

.ws-menu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.ws-menu__add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  color: var(--color-accent);
  font-weight: 600;
}

.ws-menu__hint {
  margin: 0;
  padding: var(--space-1-5) var(--space-2-5) var(--space-1-5);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  color: var(--color-text-secondary);
}
</style>
