<script setup lang="ts">
import type { Category, PageMeta } from "@typbase/typing";

import { PAGE_KIND_ICONS } from "~/lib/view";

/**
 * One page row in the sidebar: kind icon, title, home badge, and the row menu.
 * Drag state comes from the sidebar's list drag, which owns the container and
 * the drop index.
 */
defineProps<{
  page: PageMeta;
  categories: Category[];
  current: boolean;
  home: boolean;
  /** The row is first or last in its group, so that move has nowhere to go. */
  first: boolean;
  last: boolean;
  /** This row is the one being dragged. */
  dragging: boolean;
}>();

const emit = defineEmits<{
  (e: "select"): void;
  (e: "rename"): void;
  (e: "setHome"): void;
  (e: "setCategory", categoryId: string | null): void;
  (e: "convert", kind: PageMeta["kind"]): void;
  (e: "remove"): void;
  (e: "move", delta: -1 | 1): void;
  (e: "dragStart", event: PointerEvent): void;
}>();

const { t } = useI18n();
</script>

<template>
  <li
    class="sidebar__item"
    :class="{ 'sidebar__item--active': current, 'sidebar__item--drag': dragging }"
    data-drag-page
    @pointerdown="emit('dragStart', $event)"
  >
    <button
      type="button"
      class="sidebar__row"
      :aria-current="current ? 'page' : undefined"
      @click="emit('select')"
    >
      <MsIcon :name="PAGE_KIND_ICONS[page.kind]" :size="20" class="sidebar__row-kind" />
      <UiTruncatedText class="sidebar__row-label" :text="page.title" />
      <UiTooltip v-if="home" :text="$t('sidebar.homePage')">
        <span class="sidebar__row-home">
          <MsIcon name="home" :size="18" />
        </span>
      </UiTooltip>
    </button>

    <UiMenu>
      <template #trigger>
        <UiIconButton
          icon="more_vert"
          :size="20"
          :label="t('sidebar.actions', { title: page.title })"
          variant="ghost"
          class="button--tiny sidebar__row-more"
        />
      </template>

      <UiMenuItem icon="edit" @select="emit('rename')">{{ $t("common.rename") }}</UiMenuItem>
      <UiMenuItem icon="keyboard_double_arrow_up" :disabled="first" @select="emit('move', -1)">
        {{ $t("common.moveUp") }}
      </UiMenuItem>
      <UiMenuItem icon="keyboard_double_arrow_down" :disabled="last" @select="emit('move', 1)">
        {{ $t("common.moveDown") }}
      </UiMenuItem>
      <UiMenuItem icon="home" @select="emit('setHome')">{{ $t("sidebar.setHome") }}</UiMenuItem>
      <UiMenuSub icon="category" :label="$t('common.setCategory')">
        <UiMenuItem :checked="!page.categoryId" @select="emit('setCategory', null)">
          {{ $t("newPage.noCategory") }}
        </UiMenuItem>
        <UiMenuItem
          v-for="category in categories"
          :key="category.id"
          :checked="page.categoryId === category.id"
          @select="emit('setCategory', category.id)"
        >
          {{ category.name }}
        </UiMenuItem>
      </UiMenuSub>
      <UiMenuItem
        v-if="page.kind === 'notebook'"
        icon="description"
        @select="emit('convert', 'document')"
      >
        {{ $t("common.convertToDocument") }}
      </UiMenuItem>
      <UiMenuItem v-else icon="view_agenda" @select="emit('convert', 'notebook')">
        {{ $t("common.convertToNotebook") }}
      </UiMenuItem>
      <UiMenuSeparator />
      <UiMenuItem danger icon="delete" @select="emit('remove')">
        {{ $t("sidebar.delete") }}
      </UiMenuItem>
    </UiMenu>
  </li>
</template>

<style>
/* The held row is a card in the hand: the drag takes it out of the flow and
   follows the pointer, and this makes it read as lifted. The slight shrink
   leaves the open slot visible around it. */
.sidebar__item--drag {
  z-index: 2;
  transform: scale(0.97);
  background: var(--color-surface);
  box-shadow: 0 6px 16px rgb(0 0 0 / 0.18);
}
</style>
