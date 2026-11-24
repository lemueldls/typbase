import type { Ref } from "vue";

/**
 * Swipe gestures for the shell's side drawers.
 *
 * A closed drawer opens when a touch starts at its edge and moves inward. An
 * open drawer follows the finger toward its anchored edge and closes past the
 * halfway point, or on a quick fling. The drawer and its backdrop are painted
 * through CSS variables so a move writes inline styles instead of re-rendering
 * Vue. Vertical movement cancels before the axis locks, so lists still scroll.
 */

export type DrawerSide = "left" | "right";

export interface SwipeDrawerOptions {
  /** The edge the drawer is anchored to. Swiping toward it closes. */
  side: Readonly<Ref<DrawerSide>>;
  /** Current open state. Read at the start of a gesture. */
  open: Readonly<Ref<boolean>>;
  /** The panel that follows the finger. */
  drawer: Ref<HTMLElement | null>;
  /** Drawer backdrop. Its opacity follows `--drawer-progress`. */
  backdrop?: Ref<HTMLElement | null>;
  /** Only start gestures while this is true. */
  enabled: Readonly<Ref<boolean>>;
  /** Width of the opening edge in px. Omit to disable swipe-to-open. */
  edge?: number;
  /** Applies the settled state. */
  onChange: (open: boolean) => void;
  /** Another layer or drag has first claim on this touch. */
  canStart?: () => boolean;
}

/** Pixels before the gesture commits to an axis. */
const AXIS_SLOP = 7;
/** Horizontal travel must beat vertical travel by this much. */
const AXIS_BIAS = 4;
/** A flick past this speed settles in that direction. px per ms. */
const FLING_VELOCITY = 0.4;
/** Velocity older than this at release is stale, so distance decides. */
const MAX_SAMPLE_AGE_MS = 80;
/** How long the click after a swipe stays swallowed. */
const CLICK_GUARD_MS = 400;
/** Fields and controls that handle their own horizontal movement. */
const IGNORE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [data-swipe-ignore]';

export function useSwipeDrawer(options: SwipeDrawerOptions): void {
  let pointer = -1;
  let active = false;
  let locked = false;
  let moved = false;
  let startedOpen = false;
  let width = 0;
  let startX = 0;
  let startY = 0;
  let startPath: Element[] = [];
  let lastX = 0;
  let lastTime = 0;
  let velocity = 0;
  /** Last visible fraction written to the drawer. */
  let lastVisible = 0;
  let releaseClickGuard: (() => void) | undefined;

  /** Elements under the pointer, through open shadow roots. */
  function composedElements(event: PointerEvent): Element[] {
    return event.composedPath().filter((node): node is Element => node instanceof Element);
  }

  function isIgnored(path: Element[]): boolean {
    return path.some((node) => node.matches(IGNORE_SELECTOR));
  }

  /** Edge strip plus the device cutout, so a landscape notch cannot swallow it. */
  function edgeWidth(): number {
    const edge = options.edge ?? 0;
    if (edge <= 0) return 0;

    const inset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        options.side.value === "left" ? "--safe-left" : "--safe-right",
      ),
    );

    return edge + (Number.isFinite(inset) ? inset : 0);
  }

  /**
   * A canvas, graph, or other element that owns horizontal movement declares
   * `touch-action: none` or `pan-x`. The drawer leaves those touches alone.
   */
  function declinesHorizontalMove(path: Element[]): boolean {
    return path.some((node) => {
      const touchAction = getComputedStyle(node).touchAction;

      return touchAction === "none" || /(^|\s)pan-x(\s|$)/.test(touchAction);
    });
  }

  /**
   * True when a scroller under the pointer can still move in the direction the
   * finger is going. Horizontal code blocks keep their horizontal swipe; only
   * the overscroll at their edge belongs to the drawer.
   */
  function canScrollToward(path: Element[], direction: number): boolean {
    for (const node of path) {
      const style = getComputedStyle(node);
      if (!/(auto|scroll)/.test(style.overflowX)) continue;

      const max = node.scrollWidth - node.clientWidth;
      if (max <= 1) continue;
      // Finger left scrolls the content left, which raises scrollLeft.
      if (direction < 0 && node.scrollLeft < max - 1) return true;
      if (direction > 0 && node.scrollLeft > 0) return true;
    }

    return false;
  }

  function paint(offset: number, visible: number): void {
    options.drawer.value?.style.setProperty("--drawer-swipe-x", `${offset}px`);
    options.backdrop?.value?.style.setProperty("--drawer-progress", String(visible));
    lastVisible = visible;
  }

  function resetVisual(): void {
    const drawer = options.drawer.value;
    if (drawer) {
      drawer.removeAttribute("data-swiping");
      drawer.style.removeProperty("--drawer-swipe-x");
    }

    const backdrop = options.backdrop?.value;
    if (backdrop) {
      backdrop.removeAttribute("data-swiping");
      backdrop.style.removeProperty("--drawer-progress");
    }
  }

  /** Keeps the click a browser fires after a touch drag from reaching the row. */
  function guardClick(x: number, y: number): void {
    releaseClickGuard?.();

    const swallow = (event: MouseEvent) => {
      // A quick tap elsewhere is a new action, not the tail of this drag.
      if (Math.hypot(event.clientX - x, event.clientY - y) > 24) {
        releaseClickGuard?.();

        return;
      }
      releaseClickGuard?.();
      event.preventDefault();
      event.stopPropagation();
    };
    const timer = setTimeout(() => releaseClickGuard?.(), CLICK_GUARD_MS);
    releaseClickGuard = () => {
      clearTimeout(timer);
      window.removeEventListener("click", swallow, true);
      releaseClickGuard = undefined;
    };
    window.addEventListener("click", swallow, { capture: true });
  }

  function cleanup(): void {
    active = false;
    locked = false;
    moved = false;
    pointer = -1;
    startPath = [];
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("touchmove", onTouchMove);
  }

  /** Drops the gesture in place. The drawer settles back to its current state. */
  function cancel(): void {
    if (!active) return;

    cleanup();
    resetVisual();
    lastVisible = options.open.value ? 1 : 0;
  }

  function onPointerDown(event: PointerEvent): void {
    if (active || !options.enabled.value) return;
    if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return;

    const drawer = options.drawer.value;
    if (!drawer) return;

    const path = composedElements(event);
    if (isIgnored(path)) return;

    if (options.open.value) {
      if (!path.some((node) => drawer.contains(node))) return;
    } else {
      const edge = edgeWidth();
      if (edge <= 0) return;

      const fromEdge =
        options.side.value === "left"
          ? event.clientX <= edge
          : event.clientX >= window.innerWidth - edge;
      if (!fromEdge) return;
    }

    if (options.canStart && !options.canStart()) return;
    if (declinesHorizontalMove(path)) return;

    active = true;
    pointer = event.pointerId;
    startedOpen = options.open.value;
    startX = event.clientX;
    startY = event.clientY;
    startPath = path;
    lastX = event.clientX;
    lastTime = event.timeStamp || performance.now();
    velocity = 0;
    width = drawer.getBoundingClientRect().width;
    lastVisible = startedOpen ? 1 : 0;

    drawer.setAttribute("data-swiping", "");
    drawer.style.setProperty("--drawer-swipe-x", "0px");
    options.backdrop?.value?.setAttribute("data-swiping", "");
    paint(0, startedOpen ? 1 : 0);

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("blur", onBlur);
    // The edge-open gesture starts on page content, whose touch-action allows
    // scrolling. Once the axis locks this listener keeps the page still.
    if (event.pointerType === "touch") {
      window.addEventListener("touchmove", onTouchMove, { passive: false });
    }
  }

  function sample(event: PointerEvent): void {
    const now = event.timeStamp || performance.now();
    const elapsed = now - lastTime;
    if (elapsed < 1) return;

    velocity = (event.clientX - lastX) / elapsed;
    lastX = event.clientX;
    lastTime = now;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || event.pointerId !== pointer) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!locked) {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      if (Math.abs(dy) + AXIS_BIAS >= Math.abs(dx)) {
        cancel();

        return;
      }
      if (document.body.classList.contains("is-reordering")) {
        cancel();

        return;
      }

      if (canScrollToward(startPath, Math.sign(dx))) {
        cancel();

        return;
      }

      locked = true;
      moved = true;
    }

    const closing = options.side.value === "left" ? -dx : dx;
    const travel = startedOpen ? Math.max(0, closing) : Math.max(0, -closing);
    const visible = Math.min(width, travel);
    const offset =
      options.side.value === "left"
        ? startedOpen
          ? -visible
          : visible
        : startedOpen
          ? visible
          : -visible;

    paint(offset, width > 0 ? (startedOpen ? 1 - visible / width : visible / width) : 0);
    sample(event);
    event.preventDefault();
  }

  function onTouchMove(event: TouchEvent): void {
    if (!active || !locked) return;
    // A second finger is a pinch or a scroll. Leave it to the page.
    if (event.touches.length > 1) {
      cancel();

      return;
    }
    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || event.pointerId !== pointer) return;

    const releasedAt = event.timeStamp || performance.now();
    if (releasedAt - lastTime > MAX_SAMPLE_AGE_MS) velocity = 0;

    const wasLocked = locked;
    const settledAt = lastVisible;
    const wasMoved = moved;
    cleanup();
    resetVisual();

    if (!wasLocked) return;

    const openingVelocity = options.side.value === "left" ? velocity : -velocity;
    let open = settledAt >= 0.5;
    if (openingVelocity > FLING_VELOCITY) open = true;
    else if (openingVelocity < -FLING_VELOCITY) open = false;

    if (open !== options.open.value) options.onChange(open);

    if (wasMoved) guardClick(event.clientX, event.clientY);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;
    cancel();
  }

  function onBlur(): void {
    cancel();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", onPointerDown, true);
    onScopeDispose(() => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      releaseClickGuard?.();
      cancel();
    });
  }

  watch(options.open, () => {
    if (active) cancel();
    else {
      resetVisual();
      lastVisible = options.open.value ? 1 : 0;
    }
  });
  watch(options.enabled, (enabled) => {
    if (!enabled) cancel();
  });
}
