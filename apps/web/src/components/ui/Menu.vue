<script setup lang="ts">
/**
 * Dropdown menu shell: trigger slot, portaled content styled as a menu.
 * Put `UiMenuItem`s (and `UiMenuSeparator`s) in the default slot.
 */
withDefaults(
  defineProps<{
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>(),
  { align: "end", side: "bottom", sideOffset: 4 },
);

/** Optional so menus that close themselves on select can be driven too. */
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="menu" :align="align" :side="side" :side-offset="sideOffset">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.menu {
  min-width: 10rem;
  max-height: calc(100dvh - var(--space-8));
  overflow-y: auto;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  z-index: 65;
  display: flex;
  flex-direction: column;
}

.menu {
  gap: var(--space-0-5);
}

.menu [data-reka-menu-item],
.menu [data-placeholder] {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-md);
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
}

.menu [data-reka-menu-item][data-highlighted] {
  background: var(--color-accent-soft);
}

.menu .menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  font-family: inherit;
  font-size: var(--text-md);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.menu .menu__item:hover {
  background: var(--color-accent-soft);
}

.menu [data-reka-menu-item][data-disabled],
.menu .menu__item:disabled {
  opacity: 0.5;
  cursor: default;
}

.menu [data-reka-menu-item][data-disabled]:hover,
.menu .menu__item:disabled:hover {
  background: transparent;
}

.menu__danger {
  color: var(--color-danger);
}

.menu__separator {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--color-border);
}
</style>
