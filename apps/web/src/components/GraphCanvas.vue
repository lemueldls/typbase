<script setup lang="ts">
import type { ThemePaletteTokens } from "@typbase/typing";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type { GraphData, GraphNode } from "~/lib/graph";

interface SimNode extends GraphNode, SimulationNodeDatum {}
interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  weight: number;
}

const props = withDefaults(
  defineProps<{
    data: GraphData;
    palette: ThemePaletteTokens;
    labels?: "auto" | "always" | "never";
    /** Title-search matches; null means no search is active. */
    matchIds?: Set<string> | null;
    selectedId?: string | null;
  }>(),
  { labels: "auto", matchIds: null, selectedId: null },
);

const emit = defineEmits<{
  (e: "open", id: string): void;
  (e: "select", id: string | null): void;
}>();

const host = useTemplateRef<HTMLDivElement>("host");
const canvas = useTemplateRef<HTMLCanvasElement>("canvas");

const CATEGORY_HUES = ["blue", "cyan", "green", "yellow", "orange", "red", "violet"] as const;
/** Zoom range; below 0.15 the graph is a dot cloud, above 4 labels overlap. */
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Fit-to-view stops here so a two-node graph does not fill the pane. */
const FIT_MAX_ZOOM = 1.35;
/** Auto labels hold until this zoom; below it the halo text is unreadable. */
const AUTO_LABEL_ZOOM = 0.7;
/** Pointer travel under this counts as a click, not a drag. */
const CLICK_SLOP = 6;

const simulation: Simulation<SimNode, SimLink> = forceSimulation<SimNode>([])
  .force(
    "link",
    forceLink<SimNode, SimLink>([])
      .id((node) => node.id)
      .distance(80)
      .strength(0.35),
  )
  .force("charge", forceManyBody<SimNode>().strength(-180).distanceMax(500))
  .force("center", forceCenter(0, 0).strength(0.05))
  .force(
    "collide",
    forceCollide<SimNode>().radius((node) => radius(node) + 4),
  )
  .force("x", forceX<SimNode>(0).strength(0.015))
  .force("y", forceY<SimNode>(0).strength(0.015))
  .alphaDecay(0.035)
  .velocityDecay(0.5);
simulation.on("tick", () => {
  scheduleDraw();

  // Fit once the layout has spread out; fitting on the phyllotaxis seed would
  // frame the seed, not the graph, and read as a huge zoom-in.
  if (pendingFit && !cameraTouched && simulation.alpha() < 0.2) {
    pendingFit = false;
    fitView();
  }
});
simulation.stop();

const nodeById = new Map<string, SimNode>();
let links: SimLink[] = [];
/** World point at the viewport center. */
const camera = { x: 0, y: 0, k: 1 };
const viewport = { width: 0, height: 0, dpr: 1 };
const font = { family: "sans-serif", size: 10 };
let hoverId: string | null = null;
let frame = 0;
/** Deferred first fit; a camera interaction cancels it. */
let pendingFit = false;
let cameraTouched = false;

/** Live pointer positions, keyed by pointer id; two mean pinch. */
const pointerPositions = new Map<number, { x: number; y: number }>();
interface DragState {
  pointerId: number;
  node: SimNode | null;
  lastX: number;
  lastY: number;
  moved: number;
}
let drag: DragState | null = null;
let pinch: { distance: number; x: number; y: number } | null = null;

function radius(node: Pick<GraphNode, "degree">): number {
  return 4 + Math.min(10, Math.sqrt(node.degree) * 2);
}

function categoryColor(node: GraphNode): string {
  if (!node.categoryId) return props.palette.textSecondary;

  let hash = 0;
  for (const char of node.categoryId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hue = CATEGORY_HUES[Math.abs(hash) % CATEGORY_HUES.length] ?? "blue";

  return props.palette[hue];
}

/** Resolved endpoints for a link, whichever form d3 has it in. */
function endpoints(link: SimLink): { source: SimNode; target: SimNode } | null {
  const source = typeof link.source === "object" ? link.source : nodeById.get(link.source);
  const target = typeof link.target === "object" ? link.target : nodeById.get(link.target);
  if (!source || !target) return null;

  return { source, target };
}

function neighborsOf(id: string): Set<string> {
  const neighbors = new Set<string>();
  for (const link of links) {
    const ends = endpoints(link);
    if (!ends) continue;
    if (ends.source.id === id) neighbors.add(ends.target.id);
    if (ends.target.id === id) neighbors.add(ends.source.id);
  }

  return neighbors;
}

watch(
  () => props.data,
  (data) => {
    const next = new Map<string, SimNode>();
    data.nodes.forEach((node, index) => {
      const existing = nodeById.get(node.id);
      if (existing) {
        Object.assign(existing, node);
        next.set(node.id, existing);
        return;
      }

      // A phyllotaxis start spreads new nodes instead of stacking them.
      const angle = index * 2.399963;
      const distance = 12 * Math.sqrt(index);
      next.set(node.id, {
        ...node,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      });
    });
    nodeById.clear();
    for (const [id, node] of next) nodeById.set(id, node);

    links = data.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }));
    simulation.nodes([...nodeById.values()]);
    (simulation.force("link") as ForceLink<SimNode, SimLink> | null)?.links(links);

    if (!pendingFit && !cameraTouched && nodeById.size > 0) {
      pendingFit = true;
    }
    simulation.alpha(0.8).restart();
    scheduleDraw();
  },
);

watch([() => props.palette, () => props.labels, () => props.matchIds, () => props.selectedId], () =>
  scheduleDraw(),
);

function worldX(screenX: number): number {
  return camera.x + (screenX - viewport.width / 2) / camera.k;
}

function worldY(screenY: number): number {
  return camera.y + (screenY - viewport.height / 2) / camera.k;
}

function nodeAt(screenX: number, screenY: number): SimNode | null {
  const x = worldX(screenX);
  const y = worldY(screenY);
  let best: SimNode | null = null;
  let bestDistance = Infinity;

  for (const node of nodeById.values()) {
    if (node.x === undefined || node.y === undefined) continue;

    const distance = Math.hypot(node.x - x, node.y - y);
    const threshold = radius(node) + 4 / camera.k;
    if (distance <= threshold && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }

  return best;
}

function fitView(): void {
  const nodes = [...nodeById.values()].filter(
    (node) => node.x !== undefined && node.y !== undefined,
  );
  if (nodes.length === 0 || viewport.width === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x ?? 0);
    maxX = Math.max(maxX, node.x ?? 0);
    minY = Math.min(minY, node.y ?? 0);
    maxY = Math.max(maxY, node.y ?? 0);
  }

  const padding = 48;
  camera.k = Math.min(
    FIT_MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (viewport.width - padding * 2) / Math.max(1, maxX - minX),
        (viewport.height - padding * 2) / Math.max(1, maxY - minY),
      ),
    ),
  );
  camera.x = (minX + maxX) / 2;
  camera.y = (minY + maxY) / 2;
  scheduleDraw();
}

function scheduleDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw(): void {
  const element = canvas.value;
  const context = element?.getContext("2d");
  if (!element || !context || viewport.width === 0) return;

  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.save();
  context.translate(viewport.width / 2, viewport.height / 2);
  context.scale(camera.k, camera.k);
  context.translate(-camera.x, -camera.y);

  const focus = hoverId ?? props.selectedId ?? null;
  const focusNeighbors = focus ? neighborsOf(focus) : null;
  const matched = props.matchIds;
  const selected = props.selectedId;

  const nodeAlpha = (node: SimNode): number => {
    if (matched && !matched.has(node.id) && node.id !== selected) return 0.12;
    if (!focusNeighbors || node.id === focus || focusNeighbors.has(node.id)) return 1;

    return 0.15;
  };

  // Edges first so nodes sit on top.
  context.lineWidth = 1 / camera.k;
  for (const link of links) {
    const ends = endpoints(link);
    if (!ends || ends.source.x === undefined || ends.source.y === undefined) continue;
    if (ends.target.x === undefined || ends.target.y === undefined) continue;

    const touchesFocus = focus !== null && (ends.source.id === focus || ends.target.id === focus);
    context.strokeStyle = touchesFocus ? props.palette.accent : props.palette.borderStrong;
    context.globalAlpha = touchesFocus ? 0.8 : matched ? 0.12 : 0.3;
    context.beginPath();
    context.moveTo(ends.source.x, ends.source.y);
    context.lineTo(ends.target.x, ends.target.y);
    context.stroke();
  }

  context.font = `${font.size}px ${font.family}`;
  const showLabels =
    props.labels === "always" || (props.labels === "auto" && camera.k > AUTO_LABEL_ZOOM);

  for (const node of nodeById.values()) {
    if (node.x === undefined || node.y === undefined) continue;

    const alpha = nodeAlpha(node);
    const isFocus = node.id === focus;
    context.globalAlpha = alpha;
    context.fillStyle = isFocus ? props.palette.accent : categoryColor(node);
    context.beginPath();
    context.arc(node.x, node.y, radius(node), 0, Math.PI * 2);
    context.fill();

    if (isFocus || selected === node.id) {
      context.globalAlpha = 1;
      context.lineWidth = 2 / camera.k;
      context.strokeStyle = props.palette.text;
      context.stroke();
    }

    const label = node.title.length > 26 ? `${node.title.slice(0, 25)}…` : node.title;
    const labelVisible =
      isFocus || selected === node.id || (props.labels !== "never" && showLabels);
    if (labelVisible && label) {
      context.globalAlpha = Math.max(alpha, 0.85);
      context.textAlign = "center";
      context.textBaseline = "top";
      const y = node.y + radius(node) + 3 / camera.k;
      context.lineWidth = 3 / camera.k;
      context.strokeStyle = props.palette.surface;
      context.strokeText(label, node.x, y);
      context.fillStyle = props.palette.text;
      context.fillText(label, node.x, y);
    }
  }

  context.globalAlpha = 1;
  context.restore();
}

function localPoint(event: PointerEvent | WheelEvent): {
  x: number;
  y: number;
} {
  const rect = canvas.value?.getBoundingClientRect();

  return {
    x: event.clientX - (rect?.left ?? 0),
    y: event.clientY - (rect?.top ?? 0),
  };
}

function pinchState(): { distance: number; x: number; y: number } | null {
  const points = [...pointerPositions.values()];
  const [a, b] = points;
  if (!a || !b) return null;

  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function onPointerDown(event: PointerEvent): void {
  const element = canvas.value;
  if (!element) return;

  cameraTouched = true;
  element.setPointerCapture(event.pointerId);
  const point = localPoint(event);
  pointerPositions.set(event.pointerId, point);

  if (pointerPositions.size >= 2) {
    pinch = pinchState();
    drag = null;

    return;
  }

  const node = nodeAt(point.x, point.y);
  drag = {
    pointerId: event.pointerId,
    node,
    lastX: point.x,
    lastY: point.y,
    moved: 0,
  };
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event);
  const tracked = pointerPositions.has(event.pointerId);
  if (tracked) pointerPositions.set(event.pointerId, point);

  if (pointerPositions.size >= 2) {
    const next = pinchState();
    if (next && pinch) {
      zoomBy(next.distance / pinch.distance, pinch);
      panBy(next.x - pinch.x, next.y - pinch.y);
      pinch = next;
    } else {
      pinch = next;
    }
    scheduleDraw();

    return;
  }

  if (drag && drag.pointerId === event.pointerId) {
    drag.moved += Math.hypot(point.x - drag.lastX, point.y - drag.lastY);
    if (drag.node) {
      drag.node.fx = worldX(point.x);
      drag.node.fy = worldY(point.y);
      simulation.alphaTarget(0.15).restart();
    } else {
      panBy(point.x - drag.lastX, point.y - drag.lastY);
    }
    drag.lastX = point.x;
    drag.lastY = point.y;
    scheduleDraw();

    return;
  }

  if (!drag) {
    const node = nodeAt(point.x, point.y);
    const nextHover = node?.id ?? null;
    if (nextHover !== hoverId) {
      hoverId = nextHover;
      if (canvas.value) canvas.value.style.cursor = hoverId ? "pointer" : "grab";
      scheduleDraw();
    }
  }
}

function onPointerUp(event: PointerEvent): void {
  pointerPositions.delete(event.pointerId);
  if (pointerPositions.size < 2) pinch = null;

  if (!drag || drag.pointerId !== event.pointerId) return;

  if (drag.node) {
    drag.node.fx = null;
    drag.node.fy = null;
    simulation.alphaTarget(0);
    if (drag.moved < CLICK_SLOP) emit("open", drag.node.id);
  } else if (drag.moved < CLICK_SLOP) {
    emit("select", null);
  }

  drag = null;
}

function onPointerLeave(): void {
  hoverId = null;
  scheduleDraw();
}

function panBy(dx: number, dy: number): void {
  camera.x -= dx / camera.k;
  camera.y -= dy / camera.k;
}

function zoomBy(factor: number, point: { x: number; y: number }): void {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.k * factor));
  if (next === camera.k) return;

  const world = { x: worldX(point.x), y: worldY(point.y) };
  camera.k = next;
  camera.x = world.x - (point.x - viewport.width / 2) / next;
  camera.y = world.y - (point.y - viewport.height / 2) / next;
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  cameraTouched = true;
  const point = localPoint(event);
  zoomBy(Math.exp(-event.deltaY * 0.0015), point);
  scheduleDraw();
}

let observer: ResizeObserver | undefined;

function measure(): void {
  const element = host.value;
  const surface = canvas.value;
  if (!element || !surface) return;

  const rect = element.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viewport.width = rect.width;
  viewport.height = rect.height;
  viewport.dpr = dpr;
  surface.width = Math.max(1, Math.round(rect.width * dpr));
  surface.height = Math.max(1, Math.round(rect.height * dpr));
  surface.style.width = `${rect.width}px`;
  surface.style.height = `${rect.height}px`;

  // Canvas text does not inherit CSS; snapshot the host's type once per size
  // change instead of reading computed style every frame. Labels sit a step
  // below chrome text so a zoomed-in graph does not read as a wall of type.
  const styles = getComputedStyle(element);
  font.family = styles.fontFamily || "sans-serif";
  font.size = Math.max(9, Math.round((Number.parseFloat(styles.fontSize) || 13) * 0.72));
  scheduleDraw();
}

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (host.value) observer.observe(host.value);
  const surface = canvas.value;
  if (!surface) return;

  surface.addEventListener("wheel", onWheel, { passive: false });
  surface.style.cursor = "grab";
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
  simulation.stop();
  canvas.value?.removeEventListener("wheel", onWheel);
  if (frame) cancelAnimationFrame(frame);
});

defineExpose({ fit: fitView });
</script>

<template>
  <div
    ref="host"
    class="graph-canvas"
    role="img"
    :aria-label="`${data.nodes.length} nodes, ${data.edges.length} links`"
  >
    <canvas
      ref="canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    />
  </div>
</template>

<style>
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
}

.graph-canvas canvas {
  display: block;
}
</style>
