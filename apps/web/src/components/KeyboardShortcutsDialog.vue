<script setup lang="ts">
import {
  APPLICATION_SHORTCUTS,
  EDITOR_SHORTCUTS,
  formatShortcut,
  type KeyboardShortcut,
} from "~/lib/keybindings";

/**
 * The app's shortcut reference. The application rows come from the same
 * registry the handlers match against; the editor rows mirror the CodeMirror
 * keymap, which lives in the published package.
 */
const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();

const groups = computed<Array<{ id: string; title: string; items: KeyboardShortcut[] }>>(() => [
  { id: "application", title: t("shortcuts.groupApp"), items: APPLICATION_SHORTCUTS },
  { id: "editor", title: t("shortcuts.groupEditor"), items: EDITOR_SHORTCUTS },
]);

function close(): void {
  open.value = false;
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('shortcuts.title')" class="shortcuts-dialog">
    <UiIconButton
      icon="close"
      :label="t('common.close')"
      variant="ghost"
      class="shortcuts__close"
      @click="close"
    />

    <p class="shortcuts__hint">{{ t("shortcuts.hint") }}</p>

    <div class="shortcuts__groups">
      <section v-for="group in groups" :key="group.id" class="shortcuts__group">
        <h3 class="shortcuts__group-title">{{ group.title }}</h3>
        <dl class="shortcuts__list">
          <div v-for="item in group.items" :key="item.id" class="shortcuts__row">
            <dt class="shortcuts__label">{{ t(item.labelKey) }}</dt>
            <dd class="shortcuts__keys">
              <UiKbd class="shortcuts__key">{{ formatShortcut(item) }}</UiKbd>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </UiDialog>
</template>

<style>
.shortcuts-dialog {
  width: min(44rem, calc(100vw - var(--space-8)));
}

.shortcuts__close {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}

.shortcuts-dialog .dialog__title {
  padding-right: var(--space-8);
}

.shortcuts__hint {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.shortcuts__groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: var(--space-4);
}

.shortcuts__group-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.shortcuts__list {
  margin: 0;
}

.shortcuts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--control-sm);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}

.shortcuts__row:last-child {
  border-bottom: none;
}

.shortcuts__label {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.shortcuts__keys {
  flex: none;
  margin: 0;
}
</style>
