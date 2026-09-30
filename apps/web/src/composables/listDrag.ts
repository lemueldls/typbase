import type { Ref } from "vue";

/**
 * Pointer-driven list reordering. The caller tags each item with
 * `itemSelector`, hands over the container element, and gets back the state a
 * drop needs. A mouse drag starts after a few pixels of movement; a touch drag
 * starts after a short hold, so a swipe still scrolls the list. On release the
 * composable hands `onReorder` the ids in their new order.
 *
 * The drop reads as an open space rather than a line on a neighbour's border:
 * `gapIndex` is the slot the caller should leave empty and `rowHeight` is how
 * tall the dragged item is, so the caller can render the gap the row drops into.
 */

export interface ListDragOptions {
  /** Selector for the draggable items inside the container. */
  itemSelector: string;
  /** The element holding the items, resolved when a drag starts. */
  container: () => HTMLElement | null;
  /** Item ids in DOM order. */
  ids: () => readonly string[];
  /** Receives the reordered ids when a drag settles somewhere else. */
  onReorder: (ids: string[]) => void;
}

export interface ListDragState {
  /** Id of the item under the pointer, or null. */
  dragging: Ref<string | null>;
  /**
   * Index in the caller's own list where the gap element belongs, with the held
   * row still counted. The caller renders an empty element there, sized from
   * `rowHeight` and tagged `data-drag-gap` so the drag can measure past its own
   * reflow.
   */
  gapIndex: Ref<number | null>;
  /** Height of the dragged item, for sizing the gap. */
  rowHeight: Ref<number | null>;
  /** True from a drop until the next press, so the trailing click is ignored. */
  dragged: Ref<boolean>;
  /** Call from an item's `pointerdown`. */
  start: (event: PointerEvent, id: string) => void;
}

const MOVE_THRESHOLD = 5;
const HOLD_MS = 220;
const EDGE_PX = 32;
const SCROLL_STEP = 10;
const CLICK_GUARD_MS = 400;

export function useListDrag(options: ListDragOptions): ListDragState {
  const dragging = ref<string | null>(null);
  const dropIndex = ref<number | null>(null);
  const rowHeight = ref<number | null>(null);
  const dragged = ref(false);

  let container: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let pressed: string | null = null;
  /** The dragged item's place in the caller's list, which is the list order. */
  let from = -1;
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  /** The held card's box at drag start, so it can keep its place in the row. */
  let cardLeft = 0;
  let cardWidth = 0;
  /** Pointer Y less the card's top, so the row stays grabbed where it was. */
  let grabY = 0;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let guarding = false;

  /**
   * Where the gap element goes in the caller's list. The held row stays in the
   * DOM (it is only out of the flow), so a slot past the held row's own place
   * sits one row further along.
   */
  const gapIndex = computed<number | null>(() => {
    const slot = dropIndex.value;
    if (slot === null || from < 0) return null;

    return slot < from ? slot : slot + 1;
  });

  function items(): HTMLElement[] {
    if (!container) return [];

    return [...container.querySelectorAll<HTMLElement>(options.itemSelector)];
  }

  /** The dragged item, found through the caller's list rather than a data id. */
  function row(): HTMLElement | null {
    return from < 0 ? null : (items()[from] ?? null);
  }

  /** The gap the caller rendered, read back so the measurement matches it. */
  function gapElement(): HTMLElement | null {
    return container?.querySelector<HTMLElement>("[data-drag-gap]") ?? null;
  }

  /**
   * How far the open gap pushed the rows below it: its own height, plus the
   * container's own row spacing when the container is a flex or grid list, since
   * inserting one more item adds one more gap.
   */
  function gapShift(): number {
    const gap = gapElement();
    if (!gap || !container) return 0;

    const spacing = Number.parseFloat(getComputedStyle(container).rowGap) || 0;

    return gap.getBoundingClientRect().height + spacing;
  }

  /**
   * Insertion slot for a pointer position, counted over the rows the drag is not
   * holding. Every row from the open gap down is measured where it would sit with
   * the gap closed, otherwise the gap pushes its own target out of reach and the
   * slot flips back and forth as the pointer crosses a row.
   */
  function indexAt(clientY: number): number {
    const list = items();
    const open = dropIndex.value;
    // Read back rather than assumed, so a caller that pads or caps the gap still
    // measures against what it actually drew.
    const size = open === null ? 0 : gapShift();
    let slot = 0;

    for (let index = 0; index < list.length; index += 1) {
      if (index === from) continue;

      // The held row is out of the flow, so every row after it sits one up, and
      // the open gap pushes everything from its own seat down.
      const seat = index < from ? index : index - 1;
      const rect = list[index]!.getBoundingClientRect();
      const shift = open !== null && seat >= open ? size : 0;
      if (clientY < rect.top - shift + rect.height / 2) return slot;
      slot += 1;
    }

    return slot;
  }

  /** Nearest ancestor that actually scrolls, for dragging past the fold. */
  function scrollParent(element: HTMLElement | null): HTMLElement | null {
    let node = element?.parentElement ?? null;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
        return node;
      node = node.parentElement;
    }

    return null;
  }

  function autoScroll(): void {
    if (!scroller || dragging.value === null) return;

    const rect = scroller.getBoundingClientRect();
    if (lastY < rect.top + EDGE_PX) scroller.scrollTop -= SCROLL_STEP;
    else if (lastY > rect.bottom - EDGE_PX) scroller.scrollTop += SCROLL_STEP;
    // The card is positioned against the pointer, so a scroll has to move it too.
    moveDraggedRow();

    frame = requestAnimationFrame(autoScroll);
  }

  /**
   * The held row leaves the flow and rides the pointer, the way a card in a hand
   * would, so the list closes up behind it instead of keeping an empty seat. The
   * offsets are relative to the offset parent, which keeps this correct inside a
   * transformed popover as well as the plain sidebar.
   */
  function moveDraggedRow(): void {
    const held = row();
    const parent = held?.offsetParent as HTMLElement | null;
    if (!held || !parent) return;

    const base = parent.getBoundingClientRect();
    held.style.position = "absolute";
    held.style.left = `${cardLeft - base.left + parent.scrollLeft}px`;
    held.style.top = `${lastY - grabY - base.top + parent.scrollTop}px`;
    held.style.width = `${cardWidth}px`;
  }

  function beginDrag(): void {
    if (!pressed || dragging.value !== null) return;

    clearTimeout(hold);
    hold = undefined;
    dragging.value = pressed;
    document.body.classList.add("is-reordering");
    // Lift before measuring: the rows below close up, and the slot has to be
    // read against the list the pointer is about to see.
    moveDraggedRow();
    dropIndex.value = indexAt(lastY);
    frame = requestAnimationFrame(autoScroll);
  }

  /** Swallows the click the browser fires after the drop, whatever it lands
   *  on, and drops the guard if no click follows. */
  function guardClick(): void {
    if (guarding) return;
    guarding = true;

    const release = () => {
      window.removeEventListener("click", swallow, { capture: true });
      guarding = false;
    };
    function swallow(event: MouseEvent) {
      event.stopPropagation();
      event.preventDefault();
      release();
    }

    window.addEventListener("click", swallow, { capture: true });
    setTimeout(release, CLICK_GUARD_MS);
  }

  function stop(): void {
    clearTimeout(hold);
    hold = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    document.body.classList.remove("is-reordering");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    // Put the held row back in the flow while its index is still known.
    const held = row();
    if (held) {
      held.style.position = "";
      held.style.left = "";
      held.style.top = "";
      held.style.width = "";
    }
    container = null;
    scroller = null;
    pressed = null;
    from = -1;
    pointer = -1;
    dragging.value = null;
    dropIndex.value = null;
    rowHeight.value = null;
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;

    lastY = event.clientY;
    if (dragging.value === null) {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (moved <= MOVE_THRESHOLD) return;
      // A touch that moves before the hold is a scroll, not a reorder.
      if (event.pointerType === "touch") {
        stop();

        return;
      }
      beginDrag();
    }

    event.preventDefault();
    dropIndex.value = indexAt(event.clientY);
    moveDraggedRow();
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;

    const id = pressed;
    const target = dropIndex.value;
    const wasDragging = dragging.value !== null;
    if (wasDragging) guardClick();
    stop();
    if (!id || !wasDragging || target === null) return;

    // The slot counts the rows the drag is not holding, so the held id goes
    // straight into it.
    const rest = [...options.ids()].filter((entry) => entry !== id);
    rest.splice(target, 0, id);
    dragged.value = true;
    options.onReorder(rest);
  }

  function onCancel(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;

    stop();
  }

  function start(event: PointerEvent, id: string): void {
    if (event.button !== 0 || pressed) return;
    container = options.container();
    from = options.ids().indexOf(id);
    if (from < 0) {
      container = null;

      return;
    }

    pressed = id;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastY = event.clientY;
    dragged.value = false;
    const rect = row()?.getBoundingClientRect() ?? null;
    cardLeft = rect?.left ?? 0;
    cardWidth = rect?.width ?? 0;
    grabY = startY - (rect?.top ?? 0);
    rowHeight.value = rect?.height ?? null;
    scroller = scrollParent(container);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (event.pointerType === "touch") hold = setTimeout(beginDrag, HOLD_MS);
  }

  onScopeDispose(stop);

  return { dragging, gapIndex, rowHeight, dragged, start };
}
