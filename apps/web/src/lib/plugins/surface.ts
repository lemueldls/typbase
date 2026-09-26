import type { PluginAction } from "@typbase/typing";

import hostCss from "./surface.css?inline";

/**
 * Hosts one plugin surface in a shadow root. The sanitized HTML never leaves
 * the document, so there is no frame or postMessage bridge: events are wired
 * directly and actions call back into the host. Shadow DOM keeps plugin CSS
 * scoped; the sanitizer guarantees no scripts or network URLs.
 *
 * Host styles come from surface.css; the plugin's own stylesheets arrive on
 * each render and are replaced in place, which makes studio saves apply
 * without remounting the surface.
 */

export interface PluginSurfaceOptions {
  /** Plugin stylesheet texts, injected after the host sheet. */
  styles?: string[];
  /** Host components the manifest declares; anything else reports an error. */
  components?: string[];
  onAction: (action: PluginAction) => void;
  onError: (message: string) => void;
  /** Reported when the content size changes (auto-height surfaces). */
  onHeight?: (height: number) => void;
}

export interface PluginSurfaceHandle {
  render(html: string, styles?: string[]): void;
  destroy(): void;
}

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
  style.textContent = [hostCss, ...(options.styles ?? [])].join("\n");
  const root = document.createElement("div");
  root.id = "tb-root";
  shadow.append(style, root);

  let lastHeight = 0;
  let inputTimer: ReturnType<typeof setTimeout> | undefined;
  let observers: ResizeObserver[] = [];
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

  function collectFields(element: Element): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const own = element.getAttribute("data-tb-field");
    if (own) {
      // A standalone field is its own scope: sending it must not sweep in
      // every other field on the surface.
      fields[own] = fieldValue(element as HTMLInputElement);
      return fields;
    }

    const scope = element.closest("[data-tb-form]") ?? root;
    for (const input of scope.querySelectorAll<HTMLInputElement>("[data-tb-field]")) {
      const key = input.getAttribute("data-tb-field");
      if (key) fields[key] = fieldValue(input);
    }

    return fields;
  }

  /**
   * One element can carry a chain: `data-tb-chain` is a JSON array of
   * `{ name, args }`. Every entry dispatches in order with the same form
   * fields, which is how a button inserts content and closes its window in
   * one click.
   */
  function collectActions(element: Element): PluginAction[] {
    const fields = collectFields(element);
    const chain = element.getAttribute("data-tb-chain");
    if (chain) {
      try {
        const entries = JSON.parse(chain) as Array<{ name?: unknown; args?: unknown }>;
        const actions = entries
          .filter(
            (entry): entry is { name: string; args?: Record<string, unknown> } =>
              !!entry && typeof entry.name === "string",
          )
          .map((entry) => ({
            id: newId(),
            name: entry.name,
            args: (entry.args as Record<string, unknown>) ?? {},
            fields,
          }));
        if (actions.length) return actions;
      } catch (error) {
        options.onError(`bad data-tb-chain: ${String(error)}`);
      }
    }

    const name = element.getAttribute("data-tb-action");
    if (!name) return [];

    return [{ id: newId(), name, args: parseArgs(element), fields }];
  }

  function dispatch(element: Element): void {
    for (const action of collectActions(element)) options.onAction(action);
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

    const element = target.closest("[data-tb-action], [data-tb-chain]");
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

    const observer = new ResizeObserver(resize);
    observer.observe(hostElement);
    observers.push(observer);
    resize();
  }

  function mountComponents(): void {
    const declared = options.components ? new Set(options.components) : undefined;

    for (const element of root.querySelectorAll<HTMLElement>("[data-tb-component]")) {
      const name = element.getAttribute("data-tb-component") ?? "";
      if (declared && !declared.has(name)) {
        options.onError(`component "${name}" is not declared in hostComponents`);
        continue;
      }
      if (name !== "canvas") continue;
      if (element.dataset.tbMounted) continue;
      element.dataset.tbMounted = "1";
      mountCanvas(element);
    }
  }

  function teardownComponents(): void {
    for (const observer of observers) observer.disconnect();
    observers = [];
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
    render(html: string, styles?: string[]): void {
      if (styles) style.textContent = [hostCss, ...styles].join("\n");

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

      teardownComponents();
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

      mountComponents();
      reportHeight();
    },

    destroy(): void {
      if (inputTimer) clearTimeout(inputTimer);
      resizeObserver?.disconnect();
      teardownComponents();
      root.replaceChildren();
      shadow.replaceChildren();
    },
  };
}
