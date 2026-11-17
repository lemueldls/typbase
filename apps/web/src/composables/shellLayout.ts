/** The aux rail's panels, in the order the tab strip shows them. */
export type AuxiliaryPanel = "chat" | "links";

/** The last open aux panel, kept mounted while the rail closes. */
interface AuxPanelState {
  side: "left" | "right";
  panels: AuxiliaryPanel[];
  active: AuxiliaryPanel;
  chatId: string | null;
  pageId: string;
  /** Inline rails sit in the shell row. Floating rails are drawers. */
  inline: boolean;
}

export interface ShellLayoutOptions {
  isDesktop: Ref<boolean>;
  currentPageId: Ref<string>;
  currentChatId: Ref<string | null>;
  /** Closes the docked chat and writes the route. */
  closeDock: () => void;
  /** Writes the current panes to the URL. */
  replaceRoute: () => void;
}

/** Desktop sidebar widths in px. The width is device-local window chrome. */
const SIDEBAR_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 480;
/** A drag below this collapses the sidebar instead of clamping it. */
const SIDEBAR_COLLAPSE_WIDTH = 140;
/** Inline aux rail widths in px. */
const AUX_WIDTH = 360;
const AUX_MIN_WIDTH = 320;
const AUX_MAX_WIDTH = 620;
/** The width transition and the drawer transform both finish inside this. */
const AUX_CLOSE_MS = 240;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The desktop three-pane shell: the sidebar width, the inline aux rail, and
 * focus mode. The panes are plain flex children, so resizing one never changes
 * another panel's constraints.
 */
export function useShellLayout(options: ShellLayoutOptions) {
  const { isDesktop, currentPageId, currentChatId } = options;

  /** A docked chat sits beside the main pane instead of replacing it. */
  const dockChatId = ref<string | null>(null);
  const linksOpen = useLocalStorage("typbase:linksPanel", false);
  const auxSide = useLocalStorage<"left" | "right">("typbase:auxSide", "right");
  const auxActive = ref<AuxiliaryPanel>("chat");
  const auxPanels = computed<AuxiliaryPanel[]>(() => {
    const panels: AuxiliaryPanel[] = [];
    if (dockChatId.value) panels.push("chat");
    if (linksOpen.value && currentPageId.value) panels.push("links");

    return panels;
  });
  const auxPanel = computed<AuxiliaryPanel | null>(() =>
    auxPanels.value.includes(auxActive.value) ? auxActive.value : (auxPanels.value[0] ?? null),
  );

  watch(dockChatId, (id) => {
    if (id) auxActive.value = "chat";
  });
  watch(linksOpen, (open) => {
    if (open) auxActive.value = "links";
  });
  watch(auxPanels, (panels) => {
    if (!panels.includes(auxActive.value) && panels[0]) auxActive.value = panels[0];
  });

  /** The sidebar width and its collapsed flag are device-local window chrome. */
  const navWidth = useLocalStorage("typbase:navWidth", SIDEBAR_WIDTH);
  const sidebarCollapsed = useLocalStorage("typbase:sidebarCollapsed", false);
  const navResizing = ref(false);
  const auxResizing = ref(false);
  const splitterResizing = computed(() => navResizing.value || auxResizing.value);
  const sidebarSize = computed(() =>
    sidebarCollapsed.value ? 0 : clamp(navWidth.value, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  );

  const windowSize = useWindowSize();
  /**
   * Inline aux panels need room for the page and the rail. Below this they
   *  float. At 1280 with the default 300px sidebar, the page and a 360px rail
   * fit. At 1200 they do not.
   */
  const inlineAux = computed(
    () => isDesktop.value && windowSize.width.value - sidebarSize.value >= 940,
  );

  /** The floating drawer stays mounted while it slides out. */
  const auxSnapshot = shallowRef<AuxPanelState | null>(null);
  const floatingAuxOpen = ref(false);
  let auxCloseTimer: ReturnType<typeof setTimeout> | undefined;

  function finishAuxClose(): void {
    if (auxPanel.value !== null) return;

    clearTimeout(auxCloseTimer);
    auxSnapshot.value = null;
  }

  /** Drops the last rail content now, for a pane that moved into the main pane. */
  function clearAuxContent(): void {
    clearTimeout(auxCloseTimer);
    auxSnapshot.value = null;
  }

  watch(
    () => ({
      panel: auxPanel.value,
      panels: auxPanels.value,
      active: auxActive.value,
      side: auxSide.value,
      chatId: dockChatId.value,
      pageId: currentPageId.value,
      inline: inlineAux.value,
    }),
    (current) => {
      if (current.panel !== null) {
        clearTimeout(auxCloseTimer);
        auxSnapshot.value = {
          side: current.side,
          panels: [...current.panels],
          active: current.panel,
          chatId: current.chatId,
          pageId: current.pageId,
          inline: current.inline,
        };
        floatingAuxOpen.value = !current.inline;

        return;
      }

      floatingAuxOpen.value = false;
      if (!auxSnapshot.value) return;

      clearTimeout(auxCloseTimer);
      auxCloseTimer = setTimeout(finishAuxClose, AUX_CLOSE_MS);
    },
    { immediate: true },
  );

  const inlineAuxOpen = computed(() => auxPanel.value !== null && inlineAux.value);
  const leftAuxOpen = computed(() => inlineAuxOpen.value && auxSide.value === "left");
  const rightAuxOpen = computed(() => inlineAuxOpen.value && auxSide.value === "right");
  const leftAuxContent = computed(() =>
    auxSnapshot.value?.inline && auxSnapshot.value.side === "left" ? auxSnapshot.value : null,
  );
  const rightAuxContent = computed(() =>
    auxSnapshot.value?.inline && auxSnapshot.value.side === "right" ? auxSnapshot.value : null,
  );

  const auxWidth = useLocalStorage("typbase:auxWidth", AUX_WIDTH);
  auxWidth.value = clamp(auxWidth.value, AUX_MIN_WIDTH, AUX_MAX_WIDTH);

  function closeAuxPanel(panel: AuxiliaryPanel): void {
    if (panel === "chat") options.closeDock();
    else linksOpen.value = false;
  }

  function closeActiveAux(): void {
    if (auxPanel.value) closeAuxPanel(auxPanel.value);
  }

  function moveAux(side: "left" | "right"): void {
    if (auxSide.value !== side) auxSide.value = side;
  }

  /** The crumb replaces the sidebar identity when the sidebar is not visible. */
  const showWorkspaceCrumb = computed(() => !isDesktop.value || sidebarCollapsed.value);

  const dragCleanups = new Set<() => void>();

  /** Window-level pointer drag, so the handle keeps tracking outside itself. */
  function startPointerDrag(onMove: (event: PointerEvent) => void, onEnd?: () => void): void {
    const move = (event: PointerEvent) => onMove(event);
    const end = () => {
      cleanup();
      onEnd?.();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      dragCleanups.delete(cleanup);
    };

    dragCleanups.add(cleanup);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  onScopeDispose(() => {
    for (const cleanup of [...dragCleanups]) cleanup();
    clearTimeout(auxCloseTimer);
  });

  function startNavResize(event: PointerEvent): void {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarSize.value;
    navResizing.value = true;

    startPointerDrag(
      (move) => {
        const raw = Math.max(0, startWidth + (move.clientX - startX));
        if (raw <= SIDEBAR_COLLAPSE_WIDTH) {
          sidebarCollapsed.value = true;

          return;
        }

        sidebarCollapsed.value = false;
        navWidth.value = clamp(raw, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
      },
      () => {
        navResizing.value = false;
        if (sidebarCollapsed.value) {
          navWidth.value = clamp(navWidth.value, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
        }
      },
    );
  }

  /** Keyboard path for the focusable resize handle. */
  function resizeSidebarBy(delta: number): void {
    if (sidebarCollapsed.value) {
      if (delta <= 0) return;

      sidebarCollapsed.value = false;
      if (navWidth.value < SIDEBAR_MIN_WIDTH) navWidth.value = SIDEBAR_WIDTH;

      return;
    }

    const next = sidebarSize.value + delta;
    if (next <= SIDEBAR_COLLAPSE_WIDTH) {
      sidebarCollapsed.value = true;

      return;
    }

    navWidth.value = clamp(next, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  }

  /** Keyboard path for the focusable aux handle. */
  function resizeAuxBy(delta: number, side: "left" | "right"): void {
    const next = auxWidth.value + (side === "left" ? delta : -delta);
    auxWidth.value = clamp(next, AUX_MIN_WIDTH, AUX_MAX_WIDTH);
  }

  function startAuxResize(event: PointerEvent, side: "left" | "right"): void {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = clamp(auxWidth.value, AUX_MIN_WIDTH, AUX_MAX_WIDTH);
    auxResizing.value = true;

    startPointerDrag(
      (move) => {
        const delta = side === "left" ? move.clientX - startX : startX - move.clientX;
        auxWidth.value = clamp(startWidth + delta, AUX_MIN_WIDTH, AUX_MAX_WIDTH);
      },
      () => {
        auxResizing.value = false;
      },
    );
  }

  function expandSidebar(): void {
    sidebarCollapsed.value = false;
    if (navWidth.value < SIDEBAR_MIN_WIDTH) navWidth.value = SIDEBAR_WIDTH;
  }

  function toggleSidebar(): void {
    if (sidebarCollapsed.value) expandSidebar();
    else sidebarCollapsed.value = true;
  }

  /** Focus mode: the open page without window chrome. Transient, not persisted. */
  const zen = ref(false);
  let zenSidebarWasCollapsed = false;

  /**
   * Focus mode hides the app bar, the sidebar, and the page's editor chrome.
   * Entering collapses the sidebar, remembering whether it was already
   * collapsed so leaving can put it back. The app bar is only hidden by its
   * `v-if`, so the device preference is untouched.
   */
  function setZen(value: boolean): void {
    if (value === zen.value) return;
    zen.value = value;

    if (!isDesktop.value) return;

    if (value) {
      zenSidebarWasCollapsed = sidebarCollapsed.value;
      sidebarCollapsed.value = true;
    } else if (!zenSidebarWasCollapsed) {
      expandSidebar();
    }
  }

  watch(isDesktop, (desktop) => {
    if (desktop) return;

    // Narrow windows have no dock. Keep the thread open as the full pane.
    if (dockChatId.value) {
      currentChatId.value = dockChatId.value;
      dockChatId.value = null;
      clearAuxContent();
      options.replaceRoute();
    }
  });

  return {
    navWidth,
    auxWidth,
    sidebarCollapsed,
    sidebarSize,
    navResizing,
    auxResizing,
    splitterResizing,
    startNavResize,
    startAuxResize,
    resizeSidebarBy,
    resizeAuxBy,
    dockChatId,
    linksOpen,
    auxSide,
    auxActive,
    auxPanels,
    auxPanel,
    auxSnapshot,
    floatingAuxOpen,
    inlineAux,
    finishAuxClose,
    clearAuxContent,
    closeAuxPanel,
    closeActiveAux,
    moveAux,
    showWorkspaceCrumb,
    zen,
    setZen,
    toggleSidebar,
    leftAuxOpen,
    rightAuxOpen,
    leftAuxContent,
    rightAuxContent,
  };
}
