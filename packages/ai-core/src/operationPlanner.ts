import { v4 as uuidv4 } from "uuid";
import type {
  NodeType,
  PositionHint,
  EditIntent,
  PlannedMutation,
  ExcalidrawElement,
  DiagramNode,
  DiagramEdge,
} from "./types.js";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const GRID_GAP_X = 260;
const GRID_GAP_Y = 150;
const SNAP_GRID = 20;

export function snap(val: number): number {
  return Math.round(val / SNAP_GRID) * SNAP_GRID;
}

export function getNodeColors(nodeType: NodeType): { bg: string; strokeStyle: "solid" | "dashed" } {
  const palette: Record<NodeType, { bg: string; strokeStyle: "solid" | "dashed" }> = {
    service: { bg: "#a5d8ff", strokeStyle: "solid" },
    database: { bg: "#b2f2bb", strokeStyle: "solid" },
    cache: { bg: "#fff3bf", strokeStyle: "solid" },
    queue: { bg: "#ffd8a8", strokeStyle: "solid" },
    gateway: { bg: "#d0bfff", strokeStyle: "solid" },
    external: { bg: "#e9ecef", strokeStyle: "dashed" },
  };
  return palette[nodeType] ?? palette.service;
}

export function findFreeSlot(
  desiredX: number,
  desiredY: number,
  width: number,
  height: number,
  existingNodes: Map<string, DiagramNode>,
  excludeNodeId?: string
): { x: number; y: number } {
  let x = snap(desiredX);
  let y = snap(desiredY);
  const padding = 24;

  for (let attempt = 0; attempt < 25; attempt++) {
    let collides = false;
    for (const node of existingNodes.values()) {
      if (excludeNodeId && node.id === excludeNodeId) continue;
      const overlapX = x < node.x + node.width + padding && x + width + padding > node.x;
      const overlapY = y < node.y + node.height + padding && y + height + padding > node.y;
      if (overlapX && overlapY) {
        collides = true;
        break;
      }
    }
    if (!collides) return { x, y };
    y = snap(y + GRID_GAP_Y);
  }
  return { x, y };
}

export function computeEdgeGeometry(source: DiagramNode, target: DiagramNode) {
  const sCx = source.x + source.width / 2;
  const sCy = source.y + source.height / 2;
  const tCx = target.x + target.width / 2;
  const tCy = target.y + target.height / 2;
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  let startX = sCx;
  let startY = sCy;
  let endX = tCx;
  let endY = tCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal dominant connection
    startX = dx >= 0 ? source.x + source.width : source.x;
    endX = dx >= 0 ? target.x : target.x + target.width;
  } else {
    // Vertical dominant connection
    startY = dy >= 0 ? source.y + source.height : source.y;
    endY = dy >= 0 ? target.y : target.y + target.height;
  }

  return {
    x: snap(startX),
    y: snap(startY),
    points: [
      [0, 0],
      [snap(endX - startX), snap(endY - startY)],
    ] as [number, number][],
  };
}

export function createExcalidrawShape(params: {
  id: string;
  type: "rectangle" | "diamond" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  strokeStyle: "solid" | "dashed";
  boundElements: Array<{ id: string; type: "text" | "arrow" }>;
  customData: Record<string, any>;
}): ExcalidrawElement {
  return {
    id: params.id,
    type: params.type,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: params.backgroundColor,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: params.strokeStyle,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 1000000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    boundElements: params.boundElements,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: params.customData,
  };
}

export function createExcalidrawBoundText(params: {
  id: string;
  containerId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): ExcalidrawElement {
  return {
    id: params.id,
    type: "text",
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 1000000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    containerId: params.containerId,
    text: params.text,
    originalText: params.text,
    fontSize: 16,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
  };
}

export function createExcalidrawArrow(params: {
  id: string;
  x: number;
  y: number;
  points: [number, number][];
  startBinding: { elementId: string; focus: number; gap: number };
  endBinding: { elementId: string; focus: number; gap: number };
  boundElements: Array<{ id: string; type: "text" }>;
  customData: Record<string, any>;
}): ExcalidrawElement {
  return {
    id: params.id,
    type: "arrow",
    x: params.x,
    y: params.y,
    width: Math.abs(params.points[1][0] - params.points[0][0]) || 1,
    height: Math.abs(params.points[1][1] - params.points[0][1]) || 1,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: Math.floor(Math.random() * 1000000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    boundElements: params.boundElements,
    updated: Date.now(),
    link: null,
    locked: false,
    points: params.points,
    startBinding: params.startBinding,
    endBinding: params.endBinding,
    endArrowhead: "arrow",
    customData: params.customData,
  };
}

export interface WorkingGraph {
  nodes: Map<string, DiagramNode>;
  edges: Map<string, DiagramEdge>;
  elementsMap: Map<string, ExcalidrawElement>;
}

export function buildWorkingGraph(elements: ExcalidrawElement[]): WorkingGraph {
  const nodes = new Map<string, DiagramNode>();
  const edges = new Map<string, DiagramEdge>();
  const elementsMap = new Map<string, ExcalidrawElement>();

  for (const el of elements) {
    if (el.isDeleted) continue;
    elementsMap.set(el.id, JSON.parse(JSON.stringify(el)));
  }

  // First pass: Nodes and text elements
  for (const el of elementsMap.values()) {
    if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
      const boundTextId = el.boundElements?.find((b) => b.type === "text")?.id;
      const textEl = boundTextId ? elementsMap.get(boundTextId) : undefined;
      const label = el.customData?.label || textEl?.text || "Component";
      const nodeType: NodeType = el.customData?.nodeType || "service";

      nodes.set(el.id, {
        id: el.id,
        textId: boundTextId,
        label,
        nodeType,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      });
    }
  }

  // Second pass: Arrows / Edges
  for (const el of elementsMap.values()) {
    if (el.type === "arrow") {
      const sourceId = el.startBinding?.elementId || el.customData?.sourceId;
      const targetId = el.endBinding?.elementId || el.customData?.targetId;
      const boundTextId = el.boundElements?.find((b) => b.type === "text")?.id;
      const textEl = boundTextId ? elementsMap.get(boundTextId) : undefined;
      const label = el.customData?.label || textEl?.text || undefined;

      edges.set(el.id, {
        id: el.id,
        labelId: boundTextId,
        sourceId,
        targetId,
        label,
      });
    }
  }

  return { nodes, edges, elementsMap };
}

export function planOperations(
  intents: EditIntent[],
  initialElements: ExcalidrawElement[]
): PlannedMutation[] {
  const state = buildWorkingGraph(initialElements);
  const mutations: PlannedMutation[] = [];

  function execAddNode(
    label: string,
    nodeType: NodeType,
    positionHint: PositionHint = "right_of",
    anchorNodeId?: string,
    explicitCoords?: { x: number; y: number }
  ): DiagramNode {
    const nodeId = `node_${uuidv4()}`;
    const textId = `txt_${uuidv4()}`;
    const width = Math.max(NODE_WIDTH, snap(label.length * 10 + 40));
    const height = NODE_HEIGHT;

    let rawX = 200;
    let rawY = 200;

    if (explicitCoords) {
      rawX = explicitCoords.x;
      rawY = explicitCoords.y;
    } else if (anchorNodeId && state.nodes.has(anchorNodeId)) {
      const anchor = state.nodes.get(anchorNodeId)!;
      switch (positionHint) {
        case "right_of":
          rawX = anchor.x + anchor.width + GRID_GAP_X;
          rawY = anchor.y;
          break;
        case "left_of":
          rawX = anchor.x - width - GRID_GAP_X;
          rawY = anchor.y;
          break;
        case "below":
          rawX = anchor.x;
          rawY = anchor.y + anchor.height + GRID_GAP_Y;
          break;
        case "above":
          rawX = anchor.x;
          rawY = anchor.y - height - GRID_GAP_Y;
          break;
        default:
          rawX = anchor.x + GRID_GAP_X;
          rawY = anchor.y + GRID_GAP_Y;
          break;
      }
    } else if (state.nodes.size > 0) {
      let maxRight = -Infinity;
      let refY = 200;
      for (const n of state.nodes.values()) {
        if (n.x + n.width > maxRight) {
          maxRight = n.x + n.width;
          refY = n.y;
        }
      }
      rawX = maxRight + 100;
      rawY = refY;
    }

    const { x, y } = findFreeSlot(rawX, rawY, width, height, state.nodes);
    const style = getNodeColors(nodeType);

    const shapeEl = createExcalidrawShape({
      id: nodeId,
      type: nodeType === "gateway" ? "diamond" : "rectangle",
      x,
      y,
      width,
      height,
      backgroundColor: style.bg,
      strokeStyle: style.strokeStyle,
      boundElements: [{ id: textId, type: "text" }],
      customData: { bmKind: "node", nodeType, label, aiGenerated: true },
    });

    const textEl = createExcalidrawBoundText({
      id: textId,
      containerId: nodeId,
      text: label,
      x: x + 10,
      y: y + height / 2 - 12,
      width: width - 20,
      height: 24,
    });

    const nodeRecord: DiagramNode = { id: nodeId, textId, label, nodeType, x, y, width, height };
    state.nodes.set(nodeId, nodeRecord);
    state.elementsMap.set(nodeId, shapeEl);
    state.elementsMap.set(textId, textEl);

    mutations.push({ op: "add", elementId: nodeId, element: shapeEl });
    mutations.push({ op: "add", elementId: textId, element: textEl });
    return nodeRecord;
  }

  function execRemoveEdge(id: string): void {
    const edge = state.edges.get(id);
    if (!edge) return;
    if (edge.labelId) {
      mutations.push({ op: "delete", elementId: edge.labelId });
      state.elementsMap.delete(edge.labelId);
    }
    mutations.push({ op: "delete", elementId: id });
    state.edges.delete(id);
    state.elementsMap.delete(id);
  }

  function execRemoveNode(id: string): void {
    const node = state.nodes.get(id);
    if (!node) return;

    for (const [edgeId, edge] of Array.from(state.edges.entries())) {
      if (edge.sourceId === id || edge.targetId === id) {
        execRemoveEdge(edgeId);
      }
    }

    if (node.textId) {
      mutations.push({ op: "delete", elementId: node.textId });
      state.elementsMap.delete(node.textId);
    }
    mutations.push({ op: "delete", elementId: id });
    state.nodes.delete(id);
    state.elementsMap.delete(id);
  }

  function execAddEdge(sourceId: string, targetId: string, label?: string): DiagramEdge | null {
    const source = state.nodes.get(sourceId);
    const target = state.nodes.get(targetId);
    if (!source || !target) return null;

    const edgeId = `edge_${uuidv4()}`;
    const labelId = label ? `txt_${uuidv4()}` : undefined;
    const geom = computeEdgeGeometry(source, target);

    const arrowEl = createExcalidrawArrow({
      id: edgeId,
      x: geom.x,
      y: geom.y,
      points: geom.points,
      startBinding: { elementId: sourceId, focus: 0, gap: 4 },
      endBinding: { elementId: targetId, focus: 0, gap: 4 },
      boundElements: labelId ? [{ id: labelId, type: "text" }] : [],
      customData: { bmKind: "edge", sourceId, targetId, label: label ?? "" },
    });

    mutations.push({ op: "add", elementId: edgeId, element: arrowEl });
    mutations.push({
      op: "update",
      elementId: sourceId,
      patch: { appendBoundElement: { id: edgeId, type: "arrow" } },
    });
    mutations.push({
      op: "update",
      elementId: targetId,
      patch: { appendBoundElement: { id: edgeId, type: "arrow" } },
    });

    if (label && labelId) {
      const midX = geom.x + geom.points[1][0] / 2 - 40;
      const midY = geom.y + geom.points[1][1] / 2 - 12;
      const edgeTextEl = createExcalidrawBoundText({
        id: labelId,
        containerId: edgeId,
        text: label,
        x: snap(midX),
        y: snap(midY),
        width: 80,
        height: 20,
      });
      mutations.push({ op: "add", elementId: labelId, element: edgeTextEl });
      state.elementsMap.set(labelId, edgeTextEl);
    }

    const edgeRecord: DiagramEdge = { id: edgeId, labelId, sourceId, targetId, label };
    state.edges.set(edgeId, edgeRecord);
    state.elementsMap.set(edgeId, arrowEl);
    return edgeRecord;
  }

  function execRelabelElement(id: string, newLabel: string): void {
    if (state.nodes.has(id)) {
      const node = state.nodes.get(id)!;
      const newWidth = Math.max(NODE_WIDTH, snap(newLabel.length * 10 + 40));
      node.label = newLabel;
      node.width = newWidth;
      mutations.push({
        op: "update",
        elementId: id,
        patch: {
          width: newWidth,
          customData: { bmKind: "node", nodeType: node.nodeType, label: newLabel },
        },
      });
      if (node.textId) {
        mutations.push({
          op: "update",
          elementId: node.textId,
          patch: { text: newLabel, originalText: newLabel, width: newWidth - 20 },
        });
      }
    } else if (state.edges.has(id)) {
      const edge = state.edges.get(id)!;
      edge.label = newLabel;
      if (edge.labelId) {
        mutations.push({
          op: "update",
          elementId: edge.labelId,
          patch: { text: newLabel, originalText: newLabel },
        });
      }
    }
  }

  function execRepositionElement(id: string, targetX: number, targetY: number): void {
    const node = state.nodes.get(id);
    if (!node) return;
    const { x, y } = findFreeSlot(targetX, targetY, node.width, node.height, state.nodes, id);
    const dx = x - node.x;
    const dy = y - node.y;
    node.x = x;
    node.y = y;

    mutations.push({ op: "update", elementId: id, patch: { x, y } });
    if (node.textId) {
      mutations.push({ op: "update", elementId: node.textId, patch: { deltaX: dx, deltaY: dy } });
    }

    for (const edge of state.edges.values()) {
      if (edge.sourceId === id || edge.targetId === id) {
        const src = state.nodes.get(edge.sourceId ?? "");
        const dst = state.nodes.get(edge.targetId ?? "");
        if (src && dst) {
          const geom = computeEdgeGeometry(src, dst);
          mutations.push({
            op: "update",
            elementId: edge.id,
            patch: { x: geom.x, y: geom.y, points: geom.points },
          });
        }
      }
    }
  }

  function execInsertBetween(
    sourceId: string,
    targetId: string,
    newNodeSpec: { label: string; nodeType: NodeType }
  ): void {
    const source = state.nodes.get(sourceId);
    const target = state.nodes.get(targetId);
    if (!source || !target) return;

    let preservedLabel: string | undefined;
    for (const [edgeId, edge] of Array.from(state.edges.entries())) {
      if (edge.sourceId === sourceId && edge.targetId === targetId) {
        preservedLabel = edge.label;
        execRemoveEdge(edgeId);
      }
    }

    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    if (Math.abs(target.x - source.x) < GRID_GAP_X * 1.5) {
      execRepositionElement(targetId, target.x + GRID_GAP_X, target.y);
    }

    const created = execAddNode(
      newNodeSpec.label,
      newNodeSpec.nodeType,
      "right_of",
      sourceId,
      { x: midX, y: midY }
    );
    execAddEdge(sourceId, created.id, preservedLabel);
    execAddEdge(created.id, targetId);
  }

  function execForkPath(
    sourceId: string,
    branchNodeSpec: { label: string; nodeType: NodeType },
    targetId?: string
  ): void {
    const source = state.nodes.get(sourceId);
    if (!source) return;

    const created = execAddNode(
      branchNodeSpec.label,
      branchNodeSpec.nodeType,
      "below",
      sourceId,
      { x: source.x + Math.round(GRID_GAP_X * 0.6), y: source.y + GRID_GAP_Y }
    );

    execAddEdge(sourceId, created.id, "async / branch");
    if (targetId && state.nodes.has(targetId)) {
      execAddEdge(created.id, targetId);
    }
  }

  for (const intent of intents) {
    switch (intent.op) {
      case "add_node": {
        const addedNode = execAddNode(intent.label, intent.nodeType, intent.positionHint, intent.anchorNodeId);
        if (intent.anchorNodeId && state.nodes.has(intent.anchorNodeId)) {
          execAddEdge(intent.anchorNodeId, addedNode.id);
        }
        break;
      }
      case "remove_node":
        execRemoveNode(intent.id);
        break;
      case "add_edge":
        execAddEdge(intent.sourceId, intent.targetId, intent.label);
        break;
      case "remove_edge":
        execRemoveEdge(intent.id);
        break;
      case "relabel_element":
        execRelabelElement(intent.id, intent.newLabel);
        break;
      case "reposition_element":
        execRepositionElement(intent.id, intent.x, intent.y);
        break;
      case "insert_between":
        execInsertBetween(intent.sourceId, intent.targetId, intent.newNode);
        break;
      case "fork_path":
        execForkPath(intent.sourceId, intent.branchNode, intent.targetId);
        break;
    }
  }

  return mutations;
}
