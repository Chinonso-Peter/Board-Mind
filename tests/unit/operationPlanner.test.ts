import { describe, it, expect } from "vitest";
import {
  planOperations,
  findFreeSlot,
  snap,
  createExcalidrawShape,
  getNodeColors,
} from "../../packages/ai-core/src/operationPlanner.js";
import type { ExcalidrawElement, EditIntent } from "../../packages/ai-core/src/types.js";

describe("Operation Planner", () => {
  it("snaps coordinates to 20px grid", () => {
    expect(snap(19)).toBe(20);
    expect(snap(21)).toBe(20);
    expect(snap(35)).toBe(40);
    expect(snap(0)).toBe(0);
  });

  it("returns visual palette colors per node type", () => {
    expect(getNodeColors("service").bg).toBe("#a5d8ff");
    expect(getNodeColors("database").bg).toBe("#b2f2bb");
    expect(getNodeColors("cache").bg).toBe("#fff3bf");
    expect(getNodeColors("queue").bg).toBe("#ffd8a8");
    expect(getNodeColors("gateway").bg).toBe("#d0bfff");
    expect(getNodeColors("external").strokeStyle).toBe("dashed");
  });

  it("plans add_node operation with bound text", () => {
    const intents: EditIntent[] = [
      {
        op: "add_node",
        label: "API Gateway",
        nodeType: "gateway",
        positionHint: "center",
      },
    ];

    const mutations = planOperations(intents, []);
    expect(mutations.length).toBe(2); // Shape + bound text

    const shapeMutation = mutations.find((m) => m.op === "add" && m.element.type === "diamond");
    const textMutation = mutations.find((m) => m.op === "add" && m.element.type === "text");

    expect(shapeMutation).toBeDefined();
    expect(textMutation).toBeDefined();
    if (shapeMutation && shapeMutation.op === "add") {
      expect(shapeMutation.element.customData?.label).toBe("API Gateway");
      expect(shapeMutation.element.customData?.nodeType).toBe("gateway");
    }
  });

  it("plans add_edge connecting two nodes", () => {
    const initialElements: ExcalidrawElement[] = [
      createExcalidrawShape({
        id: "node_1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "Service A", nodeType: "service" },
      }),
      createExcalidrawShape({
        id: "node_2",
        type: "rectangle",
        x: 400,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#b2f2bb",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "Service B", nodeType: "database" },
      }),
    ];

    const intents: EditIntent[] = [
      {
        op: "add_edge",
        sourceId: "node_1",
        targetId: "node_2",
        label: "gRPC",
      },
    ];

    const mutations = planOperations(intents, initialElements);
    const arrowMutation = mutations.find((m) => m.op === "add" && m.element.type === "arrow");
    expect(arrowMutation).toBeDefined();
    if (arrowMutation && arrowMutation.op === "add") {
      expect(arrowMutation.element.startBinding?.elementId).toBe("node_1");
      expect(arrowMutation.element.endBinding?.elementId).toBe("node_2");
    }
  });

  it("plans insert_between by replacing direct edge and inserting node", () => {
    const initialElements: ExcalidrawElement[] = [
      createExcalidrawShape({
        id: "api_srv",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [{ id: "edge_direct", type: "arrow" }],
        customData: { bmKind: "node", label: "API", nodeType: "service" },
      }),
      createExcalidrawShape({
        id: "db_srv",
        type: "rectangle",
        x: 600,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#b2f2bb",
        strokeStyle: "solid",
        boundElements: [{ id: "edge_direct", type: "arrow" }],
        customData: { bmKind: "node", label: "Postgres", nodeType: "database" },
      }),
      {
        id: "edge_direct",
        type: "arrow",
        x: 280,
        y: 140,
        width: 320,
        height: 1,
        points: [[0, 0], [320, 0]],
        startBinding: { elementId: "api_srv", focus: 0, gap: 4 },
        endBinding: { elementId: "db_srv", focus: 0, gap: 4 },
        boundElements: [],
        customData: { bmKind: "edge", sourceId: "api_srv", targetId: "db_srv", label: "SQL query" },
      },
    ];

    const intents: EditIntent[] = [
      {
        op: "insert_between",
        sourceId: "api_srv",
        targetId: "db_srv",
        newNode: {
          label: "Redis Cache",
          nodeType: "cache",
        },
      },
    ];

    const mutations = planOperations(intents, initialElements);

    // Old edge should be deleted
    const deleteMutation = mutations.find((m) => m.op === "delete" && m.elementId === "edge_direct");
    expect(deleteMutation).toBeDefined();

    // New node should be added
    const addedNode = mutations.find(
      (m) => m.op === "add" && m.element.customData?.label === "Redis Cache"
    );
    expect(addedNode).toBeDefined();

    // Two new edges should be added
    const addedArrows = mutations.filter((m) => m.op === "add" && m.element.type === "arrow");
    expect(addedArrows.length).toBe(2);
  });

  it("plans remove_node and cascades to connected edges", () => {
    const initialElements: ExcalidrawElement[] = [
      createExcalidrawShape({
        id: "node_del",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [{ id: "txt_del", type: "text" }, { id: "edge_del", type: "arrow" }],
        customData: { bmKind: "node", label: "To Delete", nodeType: "service" },
      }),
      {
        id: "edge_del",
        type: "arrow",
        x: 280,
        y: 140,
        width: 100,
        height: 1,
        points: [[0, 0], [100, 0]],
        startBinding: { elementId: "node_del", focus: 0, gap: 4 },
        endBinding: { elementId: "target_srv", focus: 0, gap: 4 },
        boundElements: [],
        customData: { bmKind: "edge", sourceId: "node_del", targetId: "target_srv" },
      },
    ];

    const intents: EditIntent[] = [
      {
        op: "remove_node",
        id: "node_del",
      },
    ];

    const mutations = planOperations(intents, initialElements);
    expect(mutations.some((m) => m.op === "delete" && m.elementId === "node_del")).toBe(true);
    expect(mutations.some((m) => m.op === "delete" && m.elementId === "edge_del")).toBe(true);
  });
});
