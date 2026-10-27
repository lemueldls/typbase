import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

/** Shared graph layout model. App pages and published pages both fit this shape. */
export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  degree: number;
}

/** A d3 link before or after its endpoints are resolved to nodes. */
export interface LayoutLink<Node extends LayoutNode> extends SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

export interface GraphCamera {
  x: number;
  y: number;
  k: number;
}

export interface FitOptions {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

/** The force model the app and the published site share. */
export function createGraphSimulation<Node extends LayoutNode, Link extends LayoutLink<Node>>(
  nodes: Node[] = [],
  links: Link[] = [],
): Simulation<Node, Link> {
  return forceSimulation<Node>(nodes)
    .force(
      "link",
      forceLink<Node, Link>(links)
        .id((node) => node.id)
        .distance(80)
        .strength(0.35),
    )
    .force("charge", forceManyBody<Node>().strength(-180).distanceMax(500))
    .force("center", forceCenter<Node>(0, 0).strength(0.05))
    .force(
      "collide",
      forceCollide<Node>().radius((node) => graphRadius(node) + 4),
    )
    .force("x", forceX<Node>(0).strength(0.015))
    .force("y", forceY<Node>(0).strength(0.015))
    .alphaDecay(0.035)
    .velocityDecay(0.5);
}

/** Advance a simulation without waiting for its timer, for static previews. */
export function settleGraph<Node extends LayoutNode, Link extends LayoutLink<Node>>(
  simulation: Simulation<Node, Link>,
  ticks = 300,
  alphaMin = 0.02,
): void {
  simulation.stop();
  for (let tick = 0; tick < ticks; tick++) {
    simulation.tick();
    if (simulation.alpha() < alphaMin) break;
  }
  simulation.stop();
}

export function graphRadius(node: Pick<LayoutNode, "degree">): number {
  return 4 + Math.min(10, Math.sqrt(node.degree) * 2);
}

export function fitCamera(
  nodes: Array<Pick<LayoutNode, "x" | "y">>,
  width: number,
  height: number,
  options: FitOptions = {},
): GraphCamera | null {
  if (!nodes.length || width < 2 || height < 2) return null;
  const padding = options.padding ?? 48;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const k = Math.max(
    options.minZoom ?? 0.15,
    Math.min(
      options.maxZoom ?? 1.35,
      (width - padding * 2) / Math.max(1, maxX - minX),
      (height - padding * 2) / Math.max(1, maxY - minY),
    ),
  );

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    k,
  };
}

/** Hit testing in screen coordinates against the shared camera. */
export function hitTestGraph<Node extends LayoutNode>(
  nodes: Node[],
  camera: GraphCamera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  padding = 4,
): Node | null {
  const x = camera.x + (screenX - width / 2) / camera.k;
  const y = camera.y + (screenY - height / 2) / camera.k;
  let best: Node | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= graphRadius(node) + padding / camera.k && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** d3 links may still carry ids before the simulation binds them to nodes. */
export function linkEndpoints<Node extends LayoutNode>(
  link: LayoutLink<Node>,
  byId: Map<string, Node>,
): { source: Node; target: Node } | null {
  const source = typeof link.source === "object" ? link.source : byId.get(link.source);
  const target = typeof link.target === "object" ? link.target : byId.get(link.target);
  if (!source || !target) return null;

  return { source, target };
}
