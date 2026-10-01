<script setup lang="ts">
import { MenubarContent, MenubarMenu, MenubarPortal, MenubarTrigger } from "reka-ui";

/**
 * One menu of the bar: a text trigger and its portaled dropdown, styled as a
 * menu. Put `UiMenubarItem`s (and `UiMenubarSeparator`s) in the default slot.
 */
withDefaults(
  defineProps<{
    /** The trigger's text, the way a menu bar labels a menu. */
    label: string;
    /** Identity of this menu in the bar's open-menu value. */
    value: string;
    align?: "start" | "center" | "end";
    sideOffset?: number;
  }>(),
  { align: "start", sideOffset: 4 },
);

function keepSwitchFromClosing(event: PointerEvent): void {
  event.stopPropagation();
}
</script>

<template>
  <MenubarMenu :value="value">
    <MenubarTrigger class="menubar__trigger" @pointerdown="keepSwitchFromClosing">
      {{ label }}
    </MenubarTrigger>
    <MenubarPortal>
      <MenubarContent
        class="menu menubar__content"
        :align="align"
        side="bottom"
        :side-offset="sideOffset"
      >
        <slot />
      </MenubarContent>
    </MenubarPortal>
  </MenubarMenu>
</template>

<style>
.menubar__trigger {
  padding: 0 var(--space-2);
  height: var(--control-sm);
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  transition: background var(--motion-fast);
}

/* Highlighted is the roving focus landing here (arrow keys between menus), open
   is the menu's own dropdown being visible. */
.menubar__trigger:hover,
.menubar__trigger[data-highlighted],
.menubar__trigger[data-state="open"] {
  background: var(--color-accent-soft);
}

/* Inside a menu bar the window itself is draggable, so a trigger needs to opt
   out of the drag region the way the sidebar's buttons do. */
.menubar__trigger,
.menubar__trigger * {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

/* The dropdown is a menu bar's, so it sits closer to the bar than a row's menu
   and starts at its left edge. */
.menubar__content {
  min-width: 12rem;
}
</style>
