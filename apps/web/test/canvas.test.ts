import { describe, expect, it } from "vitest";

import {
  distanceToSegment,
  hitStrokeIndices,
  segmentDistance,
  segmentsIntersect,
  strokeHit,
  type CanvasPoint,
} from "../src/lib/plugins/canvas";

const point = (x: number, y: number): CanvasPoint => ({ x, y });

describe("canvas eraser geometry", () => {
  it("measures a point against a segment", () => {
    expect(distanceToSegment(point(0, 5), point(0, 0), point(10, 0))).toBe(5);
    expect(distanceToSegment(point(5, 0), point(0, 0), point(10, 0))).toBe(0);
    // Past the end, so the endpoint is the closest point.
    expect(distanceToSegment(point(13, 4), point(0, 0), point(10, 0))).toBe(5);
    expect(distanceToSegment(point(2, 2), point(2, 2), point(2, 2))).toBe(0);
  });

  it("detects crossing segments", () => {
    expect(segmentsIntersect(point(0, 5), point(10, 5), point(5, 0), point(5, 10))).toBe(true);
    expect(segmentsIntersect(point(0, 0), point(4, 0), point(5, 0), point(9, 0))).toBe(false);
    expect(segmentDistance(point(0, 5), point(10, 5), point(5, 0), point(5, 10))).toBe(0);
  });

  it("hits a stroke the eraser crosses between two samples", () => {
    // A fast drag has no sample near the vertical stroke, so only a
    // segment-to-segment test catches it.
    const stroke = {
      points: [
        [50, 0],
        [50, 100],
      ],
    };
    expect(strokeHit(stroke, point(0, 50), point(100, 50), 1)).toBe(true);
    // The drag stops short of the stroke, so nothing is touched.
    expect(strokeHit(stroke, point(0, 20), point(40, 20), 1)).toBe(false);
  });

  it("adds the brush width to the eraser reach", () => {
    const stroke = {
      points: [
        [0, 50],
        [100, 50],
      ],
      width: 30,
    };
    // 18px away, 15px of stroke half-width, 4px eraser: a hit.
    expect(strokeHit(stroke, point(0, 68), point(100, 68), 4)).toBe(true);
    // 25px away is outside the combined reach.
    expect(strokeHit(stroke, point(0, 75), point(100, 75), 4)).toBe(false);
  });

  it("handles a single-point stroke", () => {
    const dot = { points: [[50, 50]], width: 6 };

    expect(strokeHit(dot, point(0, 50), point(100, 50), 1)).toBe(true);
    expect(strokeHit(dot, point(0, 80), point(100, 80), 1)).toBe(false);
  });

  it("returns the indices of every touched stroke", () => {
    const strokes = [
      {
        points: [
          [0, 0],
          [10, 0],
        ],
      },
      {
        points: [
          [0, 40],
          [10, 40],
        ],
      },
      {
        points: [
          [0, 20],
          [10, 20],
        ],
      },
      { points: [] },
    ];

    expect(hitStrokeIndices(strokes, point(5, -5), point(5, 25), 2)).toEqual([0, 2]);
  });

  it("skips a stroke whose bounding box is elsewhere", () => {
    const stroke = {
      points: [
        [400, 400],
        [420, 420],
      ],
      width: 2,
    };

    expect(strokeHit(stroke, point(0, 0), point(10, 10), 4)).toBe(false);
  });
});
