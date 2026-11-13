import { describe, it, expect } from "vitest";
import { validateProposal } from "../../packages/ai-core/src/proposalValidator.js";
import { createExcalidrawShape } from "../../packages/ai-core/src/operationPlanner.js";
import type { ExcalidrawElement, PlannedMutation } from "../../packages/ai-core/src/types.js";

describe("Proposal Validator (6 Invariants)", () => {
  it("fails if mutations list is empty", () => {
    const result = validateProposal([], []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("zero element mutations");
  });

  it("Check 1: enforces maximum 200 elements per board", () => {
    const elements: ExcalidrawElement[] = [];
    for (let i = 0; i < 200; i++) {
      elements.push(
        createExcalidrawShape({
          id: `node_${i}`,
          type: "rectangle",
          x: i * 50,
          y: i * 50,
          width: 40,
          height: 40,
          backgroundColor: "#a5d8ff",
          strokeStyle: "solid",
          boundElements: [],
          customData: { bmKind: "node" },
        })
      );
    }

    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "node_201",
        element: createExcalidrawShape({
          id: "node_201",
          type: "rectangle",
          x: 9999,
          y: 9999,
          width: 40,
          height: 40,
          backgroundColor: "#a5d8ff",
          strokeStyle: "solid",
          boundElements: [],
          customData: { bmKind: "node" },
        }),
      },
    ];

    const result = validateProposal(elements, mutations, { allowOrphanNodes: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Element cap exceeded"))).toBe(true);
  });

  it("Check 2: fails if edge references non-existent node", () => {
    const currentElements = [
      createExcalidrawShape({
        id: "srv_a",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "A" },
      }),
    ];

    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "edge_bad",
        element: {
          id: "edge_bad",
          type: "arrow",
          x: 100,
          y: 100,
          width: 100,
          height: 10,
          startBinding: { elementId: "srv_a", focus: 0, gap: 4 },
          endBinding: { elementId: "non_existent_b", focus: 0, gap: 4 },
          customData: { bmKind: "edge", sourceId: "srv_a", targetId: "non_existent_b" },
        },
      },
    ];

    const result = validateProposal(currentElements, mutations, { allowOrphanNodes: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-existent targetId"))).toBe(true);
  });

  it("Check 3: fails on self-referencing edges", () => {
    const currentElements = [
      createExcalidrawShape({
        id: "srv_a",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "A" },
      }),
    ];

    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "edge_self",
        element: {
          id: "edge_self",
          type: "arrow",
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          startBinding: { elementId: "srv_a", focus: 0, gap: 4 },
          endBinding: { elementId: "srv_a", focus: 0, gap: 4 },
          customData: { bmKind: "edge", sourceId: "srv_a", targetId: "srv_a" },
        },
      },
    ];

    const result = validateProposal(currentElements, mutations, { allowOrphanNodes: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("is self-referencing"))).toBe(true);
  });

  it("Check 4: fails on duplicate edges with same endpoints and label", () => {
    const currentElements = [
      createExcalidrawShape({
        id: "srv_a",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "A" },
      }),
      createExcalidrawShape({
        id: "srv_b",
        type: "rectangle",
        x: 500,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#b2f2bb",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "B" },
      }),
      {
        id: "edge_1",
        type: "arrow" as const,
        x: 280,
        y: 140,
        width: 220,
        height: 1,
        startBinding: { elementId: "srv_a", focus: 0, gap: 4 },
        endBinding: { elementId: "srv_b", focus: 0, gap: 4 },
        customData: { bmKind: "edge", sourceId: "srv_a", targetId: "srv_b", label: "sync" },
      },
    ];

    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "edge_2",
        element: {
          id: "edge_2",
          type: "arrow",
          x: 280,
          y: 140,
          width: 220,
          height: 1,
          startBinding: { elementId: "srv_a", focus: 0, gap: 4 },
          endBinding: { elementId: "srv_b", focus: 0, gap: 4 },
          customData: { bmKind: "edge", sourceId: "srv_a", targetId: "srv_b", label: "sync" },
        },
      },
    ];

    const result = validateProposal(currentElements, mutations, { allowOrphanNodes: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate edge detected"))).toBe(true);
  });

  it("Check 5: detects orphan nodes when > 1 node exists without edges", () => {
    const currentElements = [
      createExcalidrawShape({
        id: "srv_a",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "A" },
      }),
    ];

    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "srv_b",
        element: createExcalidrawShape({
          id: "srv_b",
          type: "rectangle",
          x: 500,
          y: 100,
          width: 180,
          height: 80,
          backgroundColor: "#b2f2bb",
          strokeStyle: "solid",
          boundElements: [],
          customData: { bmKind: "node", label: "B" },
        }),
      },
    ];

    const result = validateProposal(currentElements, mutations, { allowOrphanNodes: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Orphan node detected"))).toBe(true);
  });

  it("Check 6: fails on bounding-box overlap between nodes", () => {
    const currentElements = [
      createExcalidrawShape({
        id: "srv_a",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "A" },
      }),
    ];

    // Overlapping position: x: 120, y: 110 overlaps with x: 100..280, y: 100..180
    const mutations: PlannedMutation[] = [
      {
        op: "add",
        elementId: "srv_overlap",
        element: createExcalidrawShape({
          id: "srv_overlap",
          type: "rectangle",
          x: 120,
          y: 110,
          width: 180,
          height: 80,
          backgroundColor: "#b2f2bb",
          strokeStyle: "solid",
          boundElements: [],
          customData: { bmKind: "node", label: "Overlapping B" },
        }),
      },
    ];

    const result = validateProposal(currentElements, mutations, { allowOrphanNodes: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Bounding box overlap"))).toBe(true);
  });
});
