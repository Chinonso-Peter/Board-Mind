import { describe, it, expect } from "vitest";
import { generateGhostOverlay } from "../../packages/ai-core/src/ghostOverlay.js";
import { createExcalidrawShape } from "../../packages/ai-core/src/operationPlanner.js";
import type { PlannedMutation } from "../../packages/ai-core/src/types.js";

describe("Ghost Overlay Generator", () => {
  it("creates dashed indigo ghost elements with locked flag and opacity 60", () => {
    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "node_redis",
        element: createExcalidrawShape({
          id: "node_redis",
          type: "rectangle",
          x: 200,
          y: 150,
          width: 180,
          height: 80,
          backgroundColor: "#fff3bf",
          strokeStyle: "solid",
          boundElements: [{ id: "txt_redis", type: "text" }],
          customData: { bmKind: "node", label: "Redis Cache", nodeType: "cache" },
        }),
      },
    ];

    const result = generateGhostOverlay(mutations, "prop_123");
    expect(result.ghostElements.length).toBe(1);

    const ghost = result.ghostElements[0];
    expect(ghost.id).toBe("ghost_node_redis");
    expect(ghost.strokeStyle).toBe("dashed");
    expect(ghost.strokeColor).toBe("#4f46e5");
    expect(ghost.backgroundColor).toBe("#eef2ff");
    expect(ghost.opacity).toBe(60);
    expect(ghost.locked).toBe(true);
    expect(ghost.customData?.isGhost).toBe(true);
    expect(ghost.customData?.proposalId).toBe("prop_123");

    // Centroid computed correctly for floating Approve/Dismiss pill
    expect(result.centroid.x).toBe(290);
    expect(result.centroid.y).toBe(114);
  });
});
