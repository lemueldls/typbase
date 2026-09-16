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

/** Workspace queued for deletion; the alert dialog opens while set. */
const pendingDelete = ref<WorkspaceInfo | null>(null);

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
    <header class="ws-screen__header">
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
          @remove="pendingDelete = info"
        />
      </li>
    </ul>
    <p v-else class="ws-screen__hint">{{ $t("switcher.noWorkspaces") }}</p>

    <button
      type="button"
      class="button button--primary ws-screen__add"
      :disabled="busy"
      @click="openCreate"
    >
      <MsIcon name="add" :size="20" />
      {{ $t("switcher.add") }}
    </button>

    <p v-if="error" class="ws-screen__error" role="alert">{{ error }}</p>
  </div>

  <template v-else>
    <PopoverRoot v-model:open="newOpen">
      <PopoverTrigger as-child>
        <slot>
          <button type="button" class="button button--icon" :aria-label="$t('switcher.switchAria')">
            <MsIcon name="swap_horiz" :size="20" />
          </button>
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
                @remove="pendingDelete = info"
              />
            </li>
          </ul>

          <div class="menu__separator" />

          <button type="button" class="menu__item ws-menu__add" @click="openCreate">
            <MsIcon name="add" :size="18" />
            {{ $t("switcher.add") }}
          </button>

          <p v-if="error" class="ws-menu__error" role="alert">{{ error }}</p>
          <!-- <p class="ws-menu__hint">{{ $t("switcher.hint") }}</p> -->
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </template>

  <WorkspaceDialog v-model:open="dialogOpen" :mode="dialogMode" :workspace="editing" />

  <AlertDialogRoot
    :open="pendingDelete !== null"
    @update:open="(open) => !open && (pendingDelete = null)"
  >
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent class="dialog">
        <AlertDialogTitle class="dialog__title">{{ $t("switcher.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription class="dialog__description">
          {{ $t("switcher.deleteConfirm", { name: pendingDelete?.name ?? "" }) }}
        </AlertDialogDescription>
        <div class="dialog__actions">
          <AlertDialogCancel as-child>
            <button type="button" class="button button--ghost">{{ $t("common.cancel") }}</button>
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <button type="button" class="button button--danger" @click="confirmDelete">
              {{ $t("common.delete") }}
            </button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.ws-screen {
  display: grid;
  place-content: center;
  gap: 1rem;
  width: min(480px, calc(100vw - 2rem));
  margin: 0 auto;
}

.ws-screen__header {
  text-align: center;
}

.ws-screen__title {
  margin: 0 0 0.35rem;
  font-size: 1.3rem;
}

.ws-screen__subtitle {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.ws-screen__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* The border and surface live on the wrapper, so the row's own hover and
   active backgrounds paint over them without a specificity fight. */
.ws-screen__list > li {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.45rem;
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
  font-size: 0.85rem;
}

.ws-menu {
  width: min(320px, calc(100vw - 2rem));
  padding: 0.35rem;
}

.ws-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0.6rem 0.45rem;
  font-size: 0.72rem;
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
  gap: 0.1rem;
}

.ws-menu__add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  color: var(--color-accent);
  font-weight: 600;
}

.ws-menu__hint {
  margin: 0;
  padding: 0.35rem 0.6rem 0.4rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary);
}
</style>
