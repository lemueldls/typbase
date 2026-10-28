/**
 * The `canvas` host component. Plugins hand it strokes as data and an action
 * name; the host owns the pointer handling, the bitmap, and the eraser hit
 * test. Erasing is geometry, so it stays here instead of asking a Typst
 * surface to measure every point against every pointer sample.
 *
 * `mountCanvas` is mounted per render and returns its own teardown, since the
 * surface runtime replaces the whole tree on every patch.
 */

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasStroke {
  id?: string;
  color?: string;
  width?: number;
  points?: number[][];
}

export interface CanvasCallbacks {
  onAction: (name: string, args: Record<string, unknown>) => void;
  onError: (message: string) => void;
}

interface CanvasProps {
  strokes?: CanvasStroke[];
  color?: string;
  width?: number;
  tool?: "draw" | "erase";
  eraseAction?: string | null;
  eraseWidth?: number;
}

function toPoint(raw: number[]): CanvasPoint {
  return { x: Number(raw[0]), y: Number(raw[1]) };
}

/** Distance from a point to a line segment. Degenerate segments are points. */
export function distanceToSegment(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 1e-9) return 0;

  return value > 0 ? 1 : -1;
}

function onSegment(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): boolean {
  const slack = 1e-9;

  return (
    b.x >= Math.min(a.x, c.x) - slack &&
    b.x <= Math.max(a.x, c.x) + slack &&
    b.y >= Math.min(a.y, c.y) - slack &&
    b.y <= Math.max(a.y, c.y) + slack
  );
}

export function segmentsIntersect(
  a0: CanvasPoint,
  a1: CanvasPoint,
  b0: CanvasPoint,
  b1: CanvasPoint,
): boolean {
  const o1 = orientation(a0, a1, b0);
  const o2 = orientation(a0, a1, b1);
  const o3 = orientation(b0, b1, a0);
  const o4 = orientation(b0, b1, a1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a0, b0, a1)) return true;
  if (o2 === 0 && onSegment(a0, b1, a1)) return true;
  if (o3 === 0 && onSegment(b0, a0, b1)) return true;
  if (o4 === 0 && onSegment(b0, a1, b1)) return true;

  return false;
}

/**
 * Distance between two segments. A crossing pair is zero, which matters for
 * the eraser: a fast drag has few samples, and its endpoints can both sit
 * away from the stroke it crosses.
 */
export function segmentDistance(
  a0: CanvasPoint,
  a1: CanvasPoint,
  b0: CanvasPoint,
  b1: CanvasPoint,
): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;

  return Math.min(
    distanceToSegment(a0, b0, b1),
    distanceToSegment(a1, b0, b1),
    distanceToSegment(b0, a0, a1),
    distanceToSegment(b1, a0, a1),
  );
}

/**
 * Whether an eraser moving from `from` to `to` touches a stroke. `radius` is
 * the eraser radius, so a wider brush stroke is hit from its own edge.
 */
export function strokeHit(
  stroke: CanvasStroke,
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): boolean {
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  if (points.length === 0) return false;

  const reach = Math.max(0, radius) + Math.max(0, Number(stroke.width) || 0) / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const raw of points) {
    const x = Number(raw[0]);
    const y = Number(raw[1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // One bounding-box check per stroke, before the segment walk. An eraser
  // segment is short, so most strokes are rejected here.
  if (
    minX - reach > Math.max(from.x, to.x) ||
    maxX + reach < Math.min(from.x, to.x) ||
    minY - reach > Math.max(from.y, to.y) ||
    maxY + reach < Math.min(from.y, to.y)
  ) {
    return false;
  }

  if (points.length === 1) {
    return distanceToSegment(toPoint(points[0]!), from, to) <= reach;
  }

  for (let index = 0; index < points.length - 1; index++) {
    const a = toPoint(points[index]!);
    const b = toPoint(points[index + 1]!);
    if (segmentDistance(a, b, from, to) <= reach) return true;
  }

  return false;
}

export function hitStrokeIndices(
  strokes: readonly CanvasStroke[],
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): number[] {
  const hits: number[] = [];
  strokes.forEach((stroke, index) => {
    if (strokeHit(stroke, from, to, radius)) hits.push(index);
  });

  return hits;
}

export function mountCanvas(hostElement: HTMLElement, callbacks: CanvasCallbacks): () => void {
  let props: CanvasProps = {};
  try {
    props = JSON.parse(hostElement.getAttribute("data-tb-props") ?? "{}") as CanvasProps;
  } catch (error) {
    callbacks.onError(`bad canvas props: ${String(error)}`);
  }

  const canvas = document.createElement("canvas");
  canvas.className = "tb-canvas";
  hostElement.append(canvas);

  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();

    return () => {};
  }

  const dpr = window.devicePixelRatio || 1;
  const strokes: CanvasStroke[] = Array.isArray(props.strokes) ? props.strokes.slice() : [];
  const tool = props.tool === "erase" ? "erase" : "draw";
  const eraseWidth = Number(props.eraseWidth) > 0 ? Number(props.eraseWidth) : 18;
  const eraseAction =
    typeof props.eraseAction === "string" && props.eraseAction ? props.eraseAction : null;
  const brushColor = props.color || "#293133";
  const brushWidth = Number(props.width) || 3;

  canvas.style.cursor = tool === "erase" ? "cell" : "crosshair";

  let current: { color: string; width: number; points: number[][] } | undefined;
  let drawing = false;
  let erasing = false;
  let erasePath: CanvasPoint[] = [];
  let erased = new Set<number>();
  let ring: CanvasPoint | null = null;

  function drawStroke(stroke: CanvasStroke): void {
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    if (points.length === 0) return;

    context!.strokeStyle = stroke.color || "#293133";
    context!.lineWidth = Number(stroke.width) || 3;
    context!.lineCap = "round";
    context!.lineJoin = "round";
    context!.beginPath();
    points.forEach((raw, index) => {
      const point = toPoint(raw);
      if (index === 0) context!.moveTo(point.x, point.y);
      else context!.lineTo(point.x, point.y);
    });
    context!.stroke();
  }

  function ringColor(): string {
    const value = getComputedStyle(hostElement).getPropertyValue("--color-text").trim();

    return value || "#5f6368";
  }

  function drawRing(at: CanvasPoint): void {
    const radius = eraseWidth / 2;
    context!.save();
    context!.beginPath();
    context!.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context!.strokeStyle = ringColor();
    context!.globalAlpha = 0.5;
    context!.lineWidth = 1.5;
    context!.stroke();
    context!.globalAlpha = 0.06;
    context!.fillStyle = ringColor();
    context!.fill();
    context!.restore();
  }

  function redraw(): void {
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    context!.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    strokes.forEach((stroke, index) => {
      if (!erased.has(index)) drawStroke(stroke);
    });
    if (current) drawStroke(current);
    if (ring) drawRing(ring);
  }

  function resize(): void {
    const rect = hostElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    redraw();
  }

  function pointOf(event: PointerEvent): CanvasPoint {
    const rect = canvas.getBoundingClientRect();

    return {
      x: Math.round((event.clientX - rect.left) * 10) / 10,
      y: Math.round((event.clientY - rect.top) * 10) / 10,
    };
  }

  function eraseSegment(from: CanvasPoint, to: CanvasPoint): void {
    if (!eraseAction) return;

    const radius = eraseWidth / 2;
    strokes.forEach((stroke, index) => {
      if (erased.has(index)) return;
      if (strokeHit(stroke, from, to, radius)) erased.add(index);
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    if (tool === "erase") {
      if (!eraseAction) return;

      erasing = true;
      canvas.setPointerCapture(event.pointerId);
      const at = pointOf(event);
      erasePath = [at];
      ring = at;
      // A tap erases the stroke under the pointer, so test the point too.
      eraseSegment(at, at);
      redraw();
      event.preventDefault();
      return;
    }

    if (!hostElement.getAttribute("data-tb-action")) return;
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const at = pointOf(event);
    current = { color: brushColor, width: brushWidth, points: [[at.x, at.y]] };
    redraw();
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (erasing) {
      const next = pointOf(event);
      const previous = erasePath.at(-1) ?? next;
      erasePath.push(next);
      ring = next;
      eraseSegment(previous, next);
      redraw();
      event.preventDefault();
      return;
    }

    if (!drawing || !current) return;
    const at = pointOf(event);
    current.points.push([at.x, at.y]);
    redraw();
    event.preventDefault();
  });

  const finish = (event: PointerEvent) => {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }

    if (erasing) {
      erasing = false;
      ring = null;
      const ids = [...erased]
        .map((index) => strokes[index]?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      if (ids.length && eraseAction) {
        // Keep them hidden until the surface re-renders from the patch.
        redraw();
        callbacks.onAction(eraseAction, { ids });
      } else {
        erased = new Set();
        redraw();
      }
      erasePath = [];
      return;
    }

    if (!drawing || !current) return;
    drawing = false;
    const actionName = hostElement.getAttribute("data-tb-action");
    const stroke = { color: current.color, width: current.width, points: current.points };
    strokes.push(stroke);
    current = undefined;
    redraw();
    if (actionName) callbacks.onAction(actionName, { stroke });
  };

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  const observer = new ResizeObserver(resize);
  observer.observe(hostElement);
  resize();

  return () => {
    observer.disconnect();
    canvas.remove();
  };
}
