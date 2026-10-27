import type { ForceLink, Simulation } from "d3-force";

import {
  createGraphSimulation,
  fitCamera,
  graphRadius,
  hitTestGraph,
  settleGraph,
  type LayoutLink,
  type LayoutNode,
} from "../../../graph/engine";

interface GraphNode extends LayoutNode {
  title: string;
  url: string;
  x: number;
  y: number;
}

interface GraphEdge {
  source: number;
  target: number;
}

interface GraphLink extends LayoutLink<GraphNode> {}

interface RawGraphNode {
  id?: string;
  title?: string;
  url?: string;
}

interface RawGraphEdge {
  source?: string;
  target?: string;
}

interface GraphPayload {
  nodes?: RawGraphNode[];
  edges?: RawGraphEdge[];
}

function mountGraph() {
  const body = document.body;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-site-graph]"));
  const panel = document.querySelector<HTMLElement>("[data-site-graph-panel]");
  const close = document.querySelector<HTMLButtonElement>("[data-site-graph-close]");
  const canvas = document.querySelector<HTMLCanvasElement>("[data-site-graph-canvas]");
  const previewCanvas = document.querySelector<HTMLCanvasElement>("[data-site-graph-preview]");
  const graphUrl = body.dataset.graph;
  if (!buttons.length || !panel || !close || !canvas || !graphUrl) return;

  const graphPanel = panel;
  const closeButton = close;
  const graphCanvas = canvas;
  const ctx = graphCanvas.getContext("2d") as CanvasRenderingContext2D;
  const previewCtx = previewCanvas?.getContext("2d") ?? null;

  const root = body.dataset.root || "./";
  const current = body.dataset.pageUrl || "";
  let graph: GraphPayload | null = null;
  let loading = false;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  let links: GraphLink[] = [];
  let simulation: Simulation<GraphNode, GraphLink> | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let previewWidth = 0;
  let previewHeight = 0;
  let previewDpr = 1;
  let previewScale = 1;
  let previewTx = 0;
  let previewTy = 0;
  let drag: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    node: GraphNode | null;
  } | null = null;
  let moved = false;
  let fitted = false;
  let cameraTouched = false;
  let activeButton: HTMLButtonElement | null = null;

  function setExpanded(expanded: boolean): void {
    for (const trigger of buttons) {
      trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  function setCursor(cursor: "grab" | "grabbing" | "pointer"): void {
    graphCanvas.dataset.cursor = cursor;
  }

  function color(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  const accent = color("--site-accent", "#3b82f6");
  const text = color("--site-text", "#111827");
  const muted = color("--site-muted", "#6b7280");
  const border = color("--site-border", "#d1d5db");
  const surface = color("--site-surface", "#f3f4f6");

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function resize(): void {
    const rect = graphCanvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    graphCanvas.width = Math.round(width * dpr);
    graphCanvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function point(node: GraphNode): { x: number; y: number } {
    return { x: node.x * scale + tx, y: node.y * scale + ty };
  }

  function worldPoint(x: number, y: number): { x: number; y: number } {
    return { x: (x - tx) / scale, y: (y - ty) / scale };
  }

  function previewVisible(): boolean {
    return Boolean(previewCanvas && previewCtx && previewWidth > 1);
  }

  function resizePreview(): void {
    if (!previewCanvas || !previewCtx) return;
    const rect = previewCanvas.getBoundingClientRect();
    previewWidth = Math.max(0, rect.width);
    previewHeight = Math.max(0, rect.height);
    previewDpr = Math.min(window.devicePixelRatio || 1, 2);
    previewCanvas.width = Math.max(1, Math.round(previewWidth * previewDpr));
    previewCanvas.height = Math.max(1, Math.round(previewHeight * previewDpr));
    previewCtx.setTransform(previewDpr, 0, 0, previewDpr, 0, 0);
  }

  function fitPreview(): void {
    const camera = fitCamera(nodes, previewWidth, previewHeight, {
      padding: 22,
      minZoom: 0.18,
      maxZoom: 1.4,
    });
    if (!camera) return;
    previewScale = camera.k;
    previewTx = previewWidth / 2 - camera.x * previewScale;
    previewTy = previewHeight / 2 - camera.y * previewScale;
  }

  function drawPreview(): void {
    if (!previewCtx || !previewVisible()) return;
    const context = previewCtx;
    context.clearRect(0, 0, previewWidth, previewHeight);
    context.fillStyle = surface;
    context.fillRect(0, 0, previewWidth, previewHeight);
    if (!nodes.length) {
      context.fillStyle = muted;
      context.font = "12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        loading ? "Loading graph..." : "No public pages yet.",
        previewWidth / 2,
        previewHeight / 2,
      );
      return;
    }
    fitPreview();

    const project = (node: GraphNode): { x: number; y: number } => ({
      x: node.x * previewScale + previewTx,
      y: node.y * previewScale + previewTy,
    });

    context.lineWidth = 1;
    context.strokeStyle = border;
    context.globalAlpha = 0.65;
    for (const edge of edges) {
      const source = project(nodes[edge.source]!);
      const target = project(nodes[edge.target]!);
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.stroke();
    }
    context.globalAlpha = 1;

    const labels = [...nodes].sort((left, right) => right.degree - left.degree).slice(0, 4);
    for (const node of nodes) {
      const projected = project(node);
      const active = node.url === current;
      const radius = 2.6 + Math.min(4, Math.sqrt(node.degree) * 1.5);
      if (active) {
        context.beginPath();
        context.arc(projected.x, projected.y, radius + 4, 0, Math.PI * 2);
        context.fillStyle = accent;
        context.globalAlpha = 0.18;
        context.fill();
        context.globalAlpha = 1;
      }
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fillStyle = active ? accent : surface;
      context.fill();
      context.lineWidth = active ? 2 : 1;
      context.strokeStyle = active ? accent : border;
      context.stroke();
    }

    context.font = "9px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    for (const node of labels) {
      const projected = project(node);
      const title = node.title.length > 20 ? `${node.title.slice(0, 19)}...` : node.title;
      context.lineWidth = 3;
      context.strokeStyle = surface;
      context.strokeText(title, projected.x, projected.y + 7);
      context.fillStyle = node.url === current ? accent : muted;
      context.fillText(title, projected.x, projected.y + 7);
    }
  }

  function createSimulation(): void {
    simulation = createGraphSimulation<GraphNode, GraphLink>();
    simulation.on("tick", onTick);
    simulation.stop();
  }

  function onTick(): void {
    draw();
    drawPreview();
    if (!fitted && !cameraTouched && simulation && simulation.alpha() < 0.15 && width > 1) {
      fitted = true;
      fit();
      draw();
    }
  }

  function settlePreview(): void {
    if (!simulation || !previewVisible() || !graphPanel.hidden) return;
    simulation.on("tick", null);
    simulation.alpha(0.8);
    settleGraph(simulation, 300, 0.02);
    simulation.on("tick", onTick);
    fitPreview();
    drawPreview();
  }

  function fit(): void {
    const camera = fitCamera(nodes, width, height, {
      padding: 48,
      minZoom: 0.15,
      maxZoom: 1.35,
    });
    if (!camera) return;
    scale = camera.k;
    tx = width / 2 - camera.x * scale;
    ty = height / 2 - camera.y * scale;
  }

  function draw(): void {
    ctx.clearRect(0, 0, width, height);
    if (loading) {
      ctx.fillStyle = muted;
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading graph...", width / 2, height / 2);
      return;
    }
    if (!nodes.length) {
      ctx.fillStyle = muted;
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No public page links yet.", width / 2, height / 2);
      return;
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    edges.forEach(function (edge) {
      const a = point(nodes[edge.source]!);
      const b = point(nodes[edge.target]!);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    const showLabels = scale > 0.7;
    nodes.forEach(function (node) {
      const p = point(node);
      const radius = graphRadius(node);
      const active = node.url === current;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = active ? accent : surface;
      ctx.fill();
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeStyle = active ? accent : border;
      ctx.stroke();
      if (showLabels) {
        ctx.fillStyle = active ? text : muted;
        ctx.font = (active ? "600 " : "400 ") + "12px system-ui, sans-serif";
        ctx.textAlign = "left";
        const title = node.title.length > 34 ? `${node.title.slice(0, 31)}...` : node.title;
        ctx.fillText(title, p.x + radius + 5, p.y + 4);
      }
    });
  }

  function reload(): void {
    if (graph || loading) return;
    loading = true;
    draw();
    drawPreview();
    void fetch(graphUrl as string, { credentials: "same-origin" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data: unknown) {
        const payload = (data ?? {}) as GraphPayload;
        graph = Array.isArray(payload.nodes) ? payload : { nodes: [], edges: [] };
        const index: Record<string, number> = Object.create(null);
        nodes = (graph.nodes ?? []).map(function (node, position) {
          const angle = position * 2.399963;
          const distance = 12 * Math.sqrt(position);
          const value: GraphNode = {
            id: String(node.id || node.url || ""),
            title: String(node.title || ""),
            url: String(node.url || "/"),
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance,
            degree: 0,
          };
          index[value.id] = position;
          index[value.url] = position;
          return value;
        });
        edges = (graph.edges ?? [])
          .map(function (edge) {
            return {
              source: index[edge.source ?? ""],
              target: index[edge.target ?? ""],
            };
          })
          .filter(function (edge): edge is GraphEdge {
            return edge.source !== undefined && edge.target !== undefined;
          });
        edges.forEach(function (edge) {
          nodes[edge.source]!.degree += 1;
          nodes[edge.target]!.degree += 1;
        });
        links = edges.map(function (edge) {
          return { source: nodes[edge.source]!, target: nodes[edge.target]! };
        });

        resize();
        resizePreview();
        if (!simulation) createSimulation();
        simulation!.nodes(nodes);
        (simulation!.force("link") as ForceLink<GraphNode, GraphLink> | null)?.links(links);
        fitted = false;
        cameraTouched = false;
        if (!graphPanel.hidden) {
          simulation!.alpha(0.8).restart();
          fitted = true;
          fit();
          draw();
        } else if (previewVisible()) {
          settlePreview();
        } else {
          simulation!.stop();
          drawPreview();
        }
      })
      .catch(function () {
        graph = { nodes: [], edges: [] };
        nodes = [];
        edges = [];
        links = [];
        draw();
        drawPreview();
      })
      .then(function () {
        loading = false;
        if (!graphPanel.hidden) draw();
      });
  }

  function open(): void {
    graphPanel.hidden = false;
    body.classList.add("site-graph-open");
    setCursor("grab");
    setExpanded(true);
    resize();
    if (graph) {
      if (simulation) simulation.alpha(0.35).restart();
      if (!fitted) {
        fitted = true;
        fit();
      }
      draw();
    } else {
      reload();
    }
    closeButton.focus();
  }

  function closePanel(): void {
    graphPanel.hidden = true;
    body.classList.remove("site-graph-open");
    setExpanded(false);
    simulation?.stop();
    (activeButton ?? buttons[0])?.focus();
  }

  function linkFor(node: GraphNode): string {
    return node.url === "/" ? root : root + node.url.replace(/^\//, "");
  }

  function hitTest(event: PointerEvent): GraphNode | null {
    const rect = graphCanvas.getBoundingClientRect();
    return hitTestGraph(
      nodes,
      {
        x: (width / 2 - tx) / scale,
        y: (height / 2 - ty) / scale,
        k: scale,
      },
      width,
      height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  setExpanded(false);
  setCursor("grab");
  for (const trigger of buttons) {
    trigger.addEventListener("click", function () {
      activeButton = trigger;
      open();
    });
  }

  resizePreview();
  if (previewVisible()) reload();
  closeButton.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !graphPanel.hidden) closePanel();
  });
  window.addEventListener("resize", function () {
    resizePreview();
    if (previewVisible()) {
      if (!graph) reload();
      else if (graphPanel.hidden && simulation && simulation.alpha() > 0.02) settlePreview();
      else drawPreview();
    }
    if (graphPanel.hidden) return;
    resize();
    draw();
  });

  graphCanvas.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();
      cameraTouched = true;
      const rect = graphCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const next = clamp(scale * Math.exp(-event.deltaY * 0.0015), 0.15, 4);
      tx = x - (x - tx) * (next / scale);
      ty = y - (y - ty) * (next / scale);
      scale = next;
      draw();
    },
    { passive: false },
  );

  graphCanvas.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || !event.isPrimary) return;
    cameraTouched = true;
    const node = hitTest(event);
    setCursor("grabbing");
    drag = {
      x: event.clientX,
      y: event.clientY,
      tx: tx,
      ty: ty,
      node: node,
    };
    moved = false;
    graphCanvas.setPointerCapture(event.pointerId);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      simulation?.alphaTarget(0.15).restart();
    }
  });

  graphCanvas.addEventListener("pointermove", function (event) {
    if (!drag) {
      setCursor(hitTest(event) ? "pointer" : "grab");
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) moved = true;
    if (drag.node) {
      const rect = graphCanvas.getBoundingClientRect();
      const world = worldPoint(event.clientX - rect.left, event.clientY - rect.top);
      drag.node.fx = world.x;
      drag.node.fy = world.y;
      simulation?.alphaTarget(0.15).restart();
    } else {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
    }
    draw();
  });

  graphCanvas.addEventListener("pointerup", function (event) {
    if (!drag) return;
    const node = drag.node;
    const wasDrag = moved;
    if (node) {
      node.fx = null;
      node.fy = null;
      simulation?.alphaTarget(0);
    }
    drag = null;
    graphCanvas.releasePointerCapture(event.pointerId);
    const hit = hitTest(event);
    setCursor(hit ? "pointer" : "grab");
    if (!wasDrag && hit) window.location.href = linkFor(hit);
  });

  graphCanvas.addEventListener("pointerleave", function () {
    if (!drag) setCursor("grab");
  });

  graphCanvas.addEventListener("pointercancel", function () {
    if (drag?.node) {
      drag.node.fx = null;
      drag.node.fy = null;
      simulation?.alphaTarget(0);
    }
    drag = null;
    setCursor("grab");
  });
}

mountGraph();
