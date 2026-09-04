<script setup lang="ts">
import type { WorkspaceInfo } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { useWorkspace } from "~/composables/workspace";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

/**
 * Create or edit a workspace: name + searchable icon, with a live preview of
 * the result. Owns its own busy/error state; the parent only opens it.
 */
const props = defineProps<{
  mode: "create" | "edit";
  /** Required in edit mode; the name/icon are seeded from it. */
  workspace?: WorkspaceInfo | null;
}>();

const open = defineModel<boolean>("open", { default: false });

const { createWorkspace, renameWorkspace, setWorkspaceIcon } = useWorkspace();
const { t } = useI18n();

const name = ref("");
const icon = ref<MaterialSymbol>(DEFAULT_WORKSPACE_ICON);
const busy = ref(false);
const error = ref("");
const nameInput = useTemplateRef<HTMLInputElement>("nameInput");

const canSubmit = computed(() => name.value.trim().length > 0 && !busy.value);

watch(open, (isOpen) => {
  if (!isOpen) return;
  busy.value = false;
  error.value = "";
  if (props.mode === "edit" && props.workspace) {
    name.value = props.workspace.name;
    icon.value = (props.workspace.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
  } else {
    name.value = "";
    icon.value = DEFAULT_WORKSPACE_ICON;
  }
});

function onOpenAutoFocus(event: Event) {
  event.preventDefault();
  nameInput.value?.focus();
}

async function submit() {
  if (busy.value || !name.value.trim()) return;
  busy.value = true;
  error.value = "";
  try {
    if (props.mode === "create") {
      await createWorkspace(name.value, icon.value);
    } else if (props.workspace) {
      await renameWorkspace(props.workspace.id, name.value);
      const current =
        (props.workspace.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
      if (icon.value !== current) await setWorkspaceIcon(props.workspace.id, icon.value);
    }
    open.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog" @open-auto-focus="onOpenAutoFocus">
        <DialogTitle class="dialog__title">
          {{ mode === "create" ? t("switcher.createTitle") : t("switcher.renameTitle") }}
        </DialogTitle>

        <div class="ws-dialog__preview" aria-hidden="true">
          <span class="ws-dialog__preview-icon">
            <MsIcon :name="icon" :size="22" />
          </span>
          <span class="ws-dialog__preview-name">
            {{ name.trim() || props.workspace?.name || t("switcher.createTitle") }}
          </span>
        </div>

        <form class="dialog__form" @submit.prevent="submit">
          <label class="dialog__field">
            {{ $t("switcher.renameName") }}
            <input
              ref="nameInput"
              v-model="name"
              class="dialog__input"
              :aria-label="$t('switcher.renameName')"
              :maxlength="80"
            />
          </label>

          <div class="dialog__field">
            <span class="dialog__field-label">{{ $t("switcher.iconLabel") }}</span>
            <IconPicker v-model="icon" />
          </div>

          <div class="dialog__actions">
            <button type="button" class="button button--ghost" @click="open = false">
              {{ $t("switcher.renameCancel") }}
            </button>
            <button type="submit" class="button button--primary" :disabled="!canSubmit">
              {{ mode === "create" ? t("switcher.create") : t("switcher.renameSave") }}
            </button>
          </div>
        </form>

        <p v-if="error" class="dialog__error" role="alert">{{ error }}</p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.ws-dialog__preview {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
}

.ws-dialog__preview-icon {
  display: grid;
  place-content: center;
  width: 2.2rem;
  height: 2.2rem;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 0.5rem;
}

.ws-dialog__preview-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.dialog__field-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>
