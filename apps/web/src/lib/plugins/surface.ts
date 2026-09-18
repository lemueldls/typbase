import type { PluginAction } from "@typbase/typing";

/**
 * Hosts one plugin surface in a shadow root. The sanitized HTML never leaves
 * the document, so there is no frame or postMessage bridge: events are wired
 * directly and actions call back into the host. Shadow DOM keeps plugin CSS
 * scoped; the sanitizer guarantees no scripts or network URLs.
 */

export interface PluginSurfaceOptions {
  /** Overlay surfaces: the root ignores pointer events, controls opt back in. */
  passThrough?: boolean;
  onAction: (action: PluginAction) => void;
  onError: (message: string) => void;
  /** Reported when the content size changes (auto-height surfaces). */
  onHeight?: (height: number) => void;
}

export interface PluginSurfaceHandle {
  render(html: string): void;
  destroy(): void;
}

const SURFACE_CSS = `
:host {
  display: block;
  color: var(--color-text, #1f2328);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.45;
  accent-color: var(--color-accent, #1e5aa0);
  caret-color: var(--color-accent, #1e5aa0);
}

/* Shadow roots do not inherit the document's ::selection rule. */
::selection {
  background: color-mix(in srgb, var(--color-accent, #1e5aa0) 30%, transparent);
}

* {
  box-sizing: border-box;
}

#tb-root {
  height: 100%;
  padding: 2px;
  overflow: auto;
}

h1, h2, h3, h4, h5, h6 {
  margin: 0.4em 0 0.2em;
  line-height: 1.25;
}

p {
  margin: 0.25em 0;
}

a {
  color: var(--color-accent, #1e5aa0);
}

.tb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--color-text, #1f2328);
  background: var(--color-surface-2, #f3f4f6);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.4rem;
  cursor: pointer;
}

.tb-button:hover:not(:disabled) {
  background: var(--color-surface-3, #e9ebee);
}

.tb-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb-button--primary {
  color: #fff;
  background: var(--color-accent, #1e5aa0);
  border-color: transparent;
}

.tb-button--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.tb-button--danger {
  color: var(--color-danger, #b42828);
  border-color: color-mix(in srgb, var(--color-danger, #b42828) 40%, transparent);
}

.tb-button--ghost {
  background: transparent;
  border-color: transparent;
}

.tb-input {
  width: 100%;
  padding: 0.3rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--color-text, #1f2328);
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.35rem;
}

.tb-input:focus {
  outline: 2px solid var(--color-accent, #1e5aa0);
  outline-offset: -1px;
}

.tb-textarea {
  resize: vertical;
  min-height: 3rem;
}

.tb-field {
  display: grid;
  gap: 0.2rem;
}

.tb-field__label {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #6b7280);
}

.tb-check {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
}

.tb-panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.6rem;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.5rem;
}

.tb-panel__title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, #6b7280);
}

.tb-stack {
  display: flex;
  flex-direction: column;
}

.tb-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.tb-grid {
  display: grid;
}

.tb-card {
  padding: 0.5rem 0.6rem;
  background: var(--color-surface-2, #f3f4f6);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.45rem;
}

.tb-badge {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  font-size: 0.7rem;
  border-radius: 999px;
  background: var(--color-surface-3, #e9ebee);
}

.tb-badge--accent {
  color: #fff;
  background: var(--color-accent, #1e5aa0);
}

.tb-badge--danger {
  background: var(--color-danger-soft, #f9e3e3);
  color: var(--color-danger, #b42828);
}

.tb-muted {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #6b7280);
}

.tb-form {
  width: 100%;
}

.tb-flash-front {
  font-size: 1.05rem;
  font-weight: 600;
}

.tb-flash-back {
  padding-top: 0.4rem;
  border-top: 1px solid var(--color-border, #e5e7eb);
}

.tb-day {
  min-height: 3.1rem;
  padding: 0.25rem 0.3rem;
  font-size: 0.78rem;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.35rem;
  overflow: hidden;
}

.tb-day--muted {
  opacity: 0.45;
}

.tb-day--today {
  border-color: var(--color-accent, #1e5aa0);
  box-shadow: inset 0 0 0 1px var(--color-accent, #1e5aa0);
}

.tb-day--weekend {
  background: var(--color-surface-2, #f3f4f6);
}

.tb-day__number {
  font-weight: 600;
  color: var(--color-text-secondary, #6b7280);
}

.tb-event {
  display: block;
  width: 100%;
  margin-top: 0.15rem;
  padding: 0.1rem 0.25rem;
  font-size: 0.7rem;
  text-align: left;
  color: var(--color-text, #1f2328);
  background: var(--color-accent-soft, #e3edf8);
  border: none;
  border-radius: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-board {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle, var(--color-border, #e5e7eb) 1px, transparent 1px) 0 0 / 18px 18px,
    var(--color-surface-2, #f3f4f6);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.5rem;
}

.tb-board--fill {
  position: fixed;
  inset: 0;
  height: auto !important;
  background: transparent;
  border: none;
  border-radius: 0;
}

.tb-floating {
  position: fixed;
  z-index: 2;
}

.tb-movable {
  position: absolute;
  touch-action: none;
  cursor: grab;
}

.tb-dragging {
  cursor: grabbing;
  opacity: 0.85;
}

.tb-draggable {
  cursor: grab;
  touch-action: none;
}

.tb-drop {
  border: 1px dashed var(--color-border-strong, #d1d5db);
  border-radius: 0.35rem;
}

.tb-drop:hover {
  border-color: var(--color-accent, #1e5aa0);
}

.tb-canvas-host {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 0.5rem;
}

.tb-canvas {
  display: block;
  touch-action: none;
}

.tb-note {
  width: 180px;
  padding: 0.4rem;
  border: 1px solid rgb(0 0 0 / 0.06);
  border-radius: 0.4rem;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.14);
}

/* The note sets its own ink inline; buttons follow it instead of the theme. */
.tb-note .tb-button {
  color: inherit;
}

.tb-note__text {
  display: block;
  width: 100%;
  min-height: 3.5rem;
  padding: 0;
  font: inherit;
  font-size: 0.82rem;
  color: inherit;
  background: transparent;
  border: none;
  resize: none;
}

.tb-note__text:focus {
  outline: none;
}
`;

const PASS_THROUGH_CSS = `
:host,
#tb-root {
  pointer-events: none;
}

[data-tb-action],
[data-tb-field],
[data-tb-move],
[data-tb-component],
button,
input,
textarea,
select,
a {
  pointer-events: auto;
}
`;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();

  return `a-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function fieldValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
  if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range")) {
    return input.value === "" ? null : Number(input.value);
  }

  return input.value;
}

export function attachPluginSurface(
  host: HTMLElement,
  options: PluginSurfaceOptions,
): PluginSurfaceHandle {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = SURFACE_CSS + (options.passThrough ? PASS_THROUGH_CSS : "");
  const root = document.createElement("div");
  root.id = "tb-root";
  shadow.append(style, root);

  if (options.passThrough) {
    // Inline styles beat any stylesheet; interactive descendants opt back in
    // through the pass-through rules above.
    host.style.pointerEvents = "none";
    root.style.pointerEvents = "none";
    root.style.overflow = "visible";
  }

  let lastHeight = 0;
  let inputTimer: ReturnType<typeof setTimeout> | undefined;
  let moving:
    | {
        element: HTMLElement;
        dx: number;
        dy: number;
        boardRect: DOMRect;
        x?: number;
        y?: number;
      }
    | undefined;

  function parseArgs(element: Element): Record<string, unknown> {
    const raw = element.getAttribute("data-tb-args");
    if (!raw) return {};

    try {
      return (JSON.parse(raw) as Record<string, unknown>) ?? {};
    } catch (error) {
      options.onError(`bad data-tb-args: ${String(error)}`);
      return {};
    }
  }

  function collectAction(element: Element): PluginAction | null {
    const name = element.getAttribute("data-tb-action");
    if (!name) return null;

    const args = parseArgs(element);
    const fields: Record<string, unknown> = {};
    const own = element.getAttribute("data-tb-field");
    if (own) {
      // A standalone field is its own scope: sending it must not sweep in
      // every other field on the surface.
      fields[own] = fieldValue(element as HTMLInputElement);
    } else {
      const scope = element.closest("[data-tb-form]") ?? root;
      for (const input of scope.querySelectorAll<HTMLInputElement>("[data-tb-field]")) {
        const key = input.getAttribute("data-tb-field");
        if (key) fields[key] = fieldValue(input);
      }
    }

    return { id: newId(), name, args, fields };
  }

  function dispatch(element: Element): void {
    const action = collectAction(element);
    if (action) options.onAction(action);
  }

  function reportHeight(): void {
    if (!options.onHeight) return;

    const height = Math.ceil(root.scrollHeight);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    options.onHeight(height);
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest("a[href]");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      // Plugin links route through the host as actions.
      event.preventDefault();
      options.onAction({ id: newId(), name: "app.link", args: { href }, fields: {} });
      return;
    }

    const element = target.closest("[data-tb-action]");
    if (!element) return;
    event.preventDefault();
    dispatch(element);
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element) || target.getAttribute("data-tb-commit") !== "input") return;
    if (inputTimer) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => dispatch(target), 350);
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element) || target.getAttribute("data-tb-commit") !== "change") return;
    dispatch(target);
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.button !== 0) return;

    const handle = target.closest<HTMLElement>("[data-tb-move]");
    if (!handle) return;
    if (target.closest("input, textarea, select, button, a, [data-tb-no-drag]")) return;

    const board = handle.closest("[data-tb-board]") ?? root;
    const rect = handle.getBoundingClientRect();
    moving = {
      element: handle,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      boardRect: board.getBoundingClientRect(),
    };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("tb-dragging");
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!moving) return;
    const x = event.clientX - moving.boardRect.left - moving.dx;
    const y = event.clientY - moving.boardRect.top - moving.dy;
    moving.x = x;
    moving.y = y;
    moving.element.style.left = `${x}px`;
    moving.element.style.top = `${y}px`;
  }

  function onPointerUp(event: PointerEvent): void {
    if (moving) {
      const handle = moving.element;
      handle.classList.remove("tb-dragging");
      const actionName = handle.getAttribute("data-tb-move");
      const x = Math.round(moving.x ?? parseFloat(handle.getAttribute("data-tb-x") ?? "0"));
      const y = Math.round(moving.y ?? parseFloat(handle.getAttribute("data-tb-y") ?? "0"));
      moving = undefined;
      if (actionName) {
        // Static args carry the record id; x/y win over any stale ones.
        options.onAction({
          id: newId(),
          name: actionName,
          args: { ...parseArgs(handle), x, y },
          fields: {},
        });
      }
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const dragged = target.closest("[data-tb-drag]");
    if (!dragged) return;

    const below = shadow.elementFromPoint(event.clientX, event.clientY);
    const drop = below?.closest("[data-tb-drop]");
    if (!drop) return;

    const actionName = dragged.getAttribute("data-tb-action");
    if (!actionName) return;
    options.onAction({
      id: newId(),
      name: actionName,
      args: {
        ...parseArgs(dragged),
        value: dragged.getAttribute("data-tb-drag"),
        target: drop.getAttribute("data-tb-drop"),
      },
      fields: {},
    });
  }

  function cancelMove(): void {
    if (!moving) return;
    moving.element.classList.remove("tb-dragging");
    moving = undefined;
  }

  function mountCanvas(hostElement: HTMLElement): void {
    let props: {
      strokes?: Array<{ color?: string; width?: number; points?: number[][] }>;
      color?: string;
      width?: number;
    } = {};
    try {
      props = JSON.parse(hostElement.getAttribute("data-tb-props") ?? "{}") as typeof props;
    } catch (error) {
      options.onError(`bad canvas props: ${String(error)}`);
    }

    const canvas = document.createElement("canvas");
    canvas.className = "tb-canvas";
    hostElement.append(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const strokes = Array.isArray(props.strokes) ? props.strokes.slice() : [];
    let current: { color: string; width: number; points: number[][] } | undefined;
    let drawing = false;

    function drawStroke(stroke: { color?: string; width?: number; points?: number[][] }): void {
      const points = Array.isArray(stroke.points) ? stroke.points : [];
      if (points.length === 0) return;
      ctx!.strokeStyle = stroke.color || "#1f2328";
      ctx!.lineWidth = Number(stroke.width) || 3;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      points.forEach((pt, index) => {
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        if (index === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      });
      ctx!.stroke();
    }

    function redraw(): void {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      for (const stroke of strokes) drawStroke(stroke);
      if (current) drawStroke(current);
    }

    function resize(): void {
      const rect = hostElement.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      redraw();
    }

    function point(event: PointerEvent): number[] {
      const rect = canvas.getBoundingClientRect();

      return [
        Math.round((event.clientX - rect.left) * 10) / 10,
        Math.round((event.clientY - rect.top) * 10) / 10,
      ];
    }

    canvas.addEventListener("pointerdown", (event) => {
      if (!hostElement.getAttribute("data-tb-action")) return;
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      current = {
        color: props.color || "#1f2328",
        width: Number(props.width) || 3,
        points: [point(event)],
      };
      redraw();
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!drawing || !current) return;
      current.points.push(point(event));
      redraw();
      event.preventDefault();
    });

    const finish = (event: PointerEvent) => {
      if (!drawing || !current) return;
      drawing = false;
      const actionName = hostElement.getAttribute("data-tb-action");
      const stroke = { color: current.color, width: current.width, points: current.points };
      strokes.push(stroke);
      current = undefined;
      redraw();
      if (actionName) {
        options.onAction({ id: newId(), name: actionName, args: { stroke }, fields: {} });
      }
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    new ResizeObserver(resize).observe(hostElement);
    resize();
  }

  function scanComponents(): void {
    for (const element of root.querySelectorAll<HTMLElement>("[data-tb-component='canvas']")) {
      if (element.dataset.tbMounted) continue;
      element.dataset.tbMounted = "1";
      mountCanvas(element);
    }
  }

  root.addEventListener("submit", (event) => event.preventDefault());
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", cancelMove);

  const resizeObserver = options.onHeight ? new ResizeObserver(() => reportHeight()) : undefined;
  resizeObserver?.observe(root);

  return {
    render(html: string): void {
      // Keep typing focus across a render: plugin patches often follow input.
      const active = (shadow.activeElement ?? document.activeElement) as HTMLElement | null;
      const focusKey = active?.getAttribute?.("data-tb-field") ?? null;
      const selectionStart =
        active && typeof (active as HTMLInputElement).selectionStart === "number"
          ? (active as HTMLInputElement).selectionStart
          : null;
      const selectionEnd =
        active && typeof (active as HTMLInputElement).selectionEnd === "number"
          ? (active as HTMLInputElement).selectionEnd
          : null;

      root.innerHTML = html;

      if (focusKey) {
        const next = [...root.querySelectorAll<HTMLInputElement>("[data-tb-field]")].find(
          (element) => element.getAttribute("data-tb-field") === focusKey,
        );
        if (next) {
          next.focus();
          if (selectionStart !== null && typeof next.setSelectionRange === "function") {
            try {
              next.setSelectionRange(selectionStart, selectionEnd);
            } catch {
              // not a text control
            }
          }
        }
      }

      scanComponents();
      reportHeight();
    },

    destroy(): void {
      if (inputTimer) clearTimeout(inputTimer);
      resizeObserver?.disconnect();
      root.replaceChildren();
      shadow.replaceChildren();
    },
  };
}
