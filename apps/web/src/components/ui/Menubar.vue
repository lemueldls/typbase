<script setup lang="ts">
import { MenubarRoot } from "reka-ui";

const open = defineModel<string>("open", { default: "" });

const bar = useTemplateRef<InstanceType<typeof MenubarRoot>>("bar");
/**
 * The menu this bar is switching to. The old menu reports its close a tick
 * later, and that close must not clear the target.
 */
let switching: string | null = null;
let switchTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * When a menu last opened. A close inside the grace window is the previous
 * menu's focus-outside, not a real dismissal.
 */
let openedAt = 0;
const SWITCH_GRACE_MS = 100;

useBackLayer(
  computed(() => open.value !== ""),
  () => {
    open.value = "";
  },
);

function barElement(): HTMLElement | null {
  return (bar.value?.$el as HTMLElement | undefined) ?? null;
}

function menuValues(): string[] {
  const element = barElement();
  if (!element) return [];

  return [...element.querySelectorAll<HTMLElement>(".menubar__trigger")]
    .map((trigger) => trigger.dataset.value ?? "")
    .filter(Boolean);
}

function switchTo(value: string): void {
  switching = value;
  openedAt = Date.now();
  open.value = value;
  // The old menu reports its close a tick or two after the new one opens.
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => {
    switching = null;
  }, SWITCH_GRACE_MS);
}

onBeforeUnmount(() => clearTimeout(switchTimer));

/**
 * A real click or key press ends the switch guard, so a menu item can close
 * the bar right after a menu switch.
 */
function clearSwitchGuard(): void {
  switching = null;
  openedAt = 0;
  clearTimeout(switchTimer);
}

useEventListener(document, "pointerdown", clearSwitchGuard, { capture: true });

/**
 * Reka closes the previous menu when focus moves into the one that replaced it.
 * Its event type says boolean, but the menubar's value is the open menu's id.
 */
function onOpenChange(value: string | boolean): void {
  const next = typeof value === "string" ? value : "";

  if (next === "") {
    if (switching || Date.now() - openedAt < SWITCH_GRACE_MS) return;
  } else {
    openedAt = Date.now();
    switching = null;
  }

  clearTimeout(switchTimer);
  open.value = next;
}

/**
 * Arrow keys move between the bar's menus. Reka's own handler works to the
 * right but the old menu's focus-outside clears the open value on the way
 * left, so the bar handles both directions and stops the event before the
 * menu's own handlers see it.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    clearSwitchGuard();

    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!open.value || event.defaultPrevented) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("input, textarea, [contenteditable='true']")) return;

  // A submenu handles its arrows: right opens it and left closes it.
  if (event.key === "ArrowRight" && target.closest("[data-reka-menubar-subtrigger]")) return;
  const content = target.closest("[data-reka-menu-content]");
  if (content && !content.hasAttribute("data-reka-menubar-content")) return;
  if (!content && !target.closest(".menubar__trigger")) return;

  const values = menuValues();
  const index = values.indexOf(open.value);
  const next = values[index + (event.key === "ArrowRight" ? 1 : -1)];
  if (!next) return;

  event.preventDefault();
  event.stopPropagation();
  switchTo(next);
}

useEventListener(document, "keydown", onKeydown, { capture: true });
</script>

<template>
  <MenubarRoot ref="bar" class="menubar" :model-value="open" @update:model-value="onOpenChange">
    <slot />
  </MenubarRoot>
</template>

<style>
.menubar {
  display: flex;
  align-items: center;
  gap: var(--space-0-5);
}
</style>
