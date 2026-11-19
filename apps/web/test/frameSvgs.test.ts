//! Frame SVG reuse across compiles: the engine leaves `svg` empty for hashes
//! the client already has, and the client fills them from its cache.

import type { SvgRangedFrame } from "@typbase/engine";

import { describe, expect, it } from "vitest";

import { hydrateFrameSvgs, knownFrameHashes } from "../../../packages/codemirror/src/frames";

function frame(hash: number, svg: string): SvgRangedFrame {
  return {
    range: { start: 0, end: 1 },
    render: { svg, width: 10, height: 10, xOffset: 0, yOffset: 0, hash },
  };
}

describe("frame svg reuse", () => {
  it("fills an omitted frame from the cache and reports the hash", () => {
    hydrateFrameSvgs([frame(101, "<svg>first</svg>")]);

    expect(knownFrameHashes()).toContain(101);

    const reused = frame(101, "");
    hydrateFrameSvgs([reused]);

    expect(reused.render.svg).toBe("<svg>first</svg>");
  });

  it("leaves a frame the client never sent a hash for alone", () => {
    const fresh = frame(202, "");

    hydrateFrameSvgs([fresh]);

    expect(fresh.render.svg).toBe("");
  });

  it("fills reused frames before caching new ones evicts them", () => {
    const seeded = Array.from({ length: 512 }, (_, index) =>
      frame(1000 + index, `<svg>${index}</svg>`),
    );
    hydrateFrameSvgs(seeded);

    const fresh = Array.from({ length: 10 }, (_, index) =>
      frame(2000 + index, `<svg>new ${index}</svg>`),
    );
    const reused = frame(1000, "");

    hydrateFrameSvgs([...fresh, reused]);

    expect(reused.render.svg).toBe("<svg>0</svg>");
  });
});
