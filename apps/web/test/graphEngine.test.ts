import { describe, expect, it } from "vitest";

import {
  createGraphSimulation,
  fitCamera,
  graphRadius,
  hitTestGraph,
  settleGraph,
  type LayoutLink,
  type LayoutNode,
} from "../src/lib/graph/engine";

interface Node extends LayoutNode {
  x: number;
  y: number;
}

function node(id: string, x: number, y: number, degree = 0): Node {
  return { id, x, y, degree };
}

describe("shared graph engine", () => {
  it("uses degree for the shared node radius", () => {
    expect(graphRadius({ degree: 0 })).toBe(4);
    expect(graphRadius({ degree: 9 })).toBe(10);
    expect(graphRadius({ degree: 1000 })).toBe(14);
  });

  it("settles a simulation into finite node positions", () => {
    const nodes = [node("a", 0, 0, 1), node("b", 0, 0, 1), node("c", 0, 0, 0)];
    const links = [
      { source: nodes[0]!, target: nodes[1]! },
      { source: nodes[1]!, target: nodes[2]! },
    ] as Array<LayoutLink<Node>>;
    const simulation = createGraphSimulation<Node, LayoutLink<Node>>(nodes, links);

    settleGraph(simulation, 120, 0.05);

    expect(nodes.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))).toBe(true);
    expect(new Set(nodes.map((entry) => `${entry.x.toFixed(2)},${entry.y.toFixed(2)}`)).size).toBe(
      3,
    );
  });

  it("fits and centers the visible nodes with a zoom cap", () => {
    const camera = fitCamera([node("a", 0, 0), node("b", 100, 100)], 320, 200, {
      padding: 40,
      minZoom: 0.15,
      maxZoom: 1.35,
    });

    expect(camera).toEqual({ x: 50, y: 50, k: 1.2 });
  });

  it("hit tests against the shared camera", () => {
    const nodes = [node("b", 2, 0, 0), node("a", 0, 0, 4), node("c", 40, 0, 0)];
    const camera = { x: 0, y: 0, k: 1 };

    expect(hitTestGraph(nodes, camera, 100, 100, 50, 50)?.id).toBe("a");
    expect(hitTestGraph(nodes, camera, 100, 100, 52, 50)?.id).toBe("b");
    expect(hitTestGraph(nodes, camera, 100, 100, 10, 50)).toBeNull();
  });
});
