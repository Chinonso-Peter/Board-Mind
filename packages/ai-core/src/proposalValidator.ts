import type {
  ExcalidrawElement,
  PlannedMutation,
  ValidationResult,
  DiagramNode,
  DiagramEdge,
} from "./types.js";

const MAX_BOARD_ELEMENTS = 200;
const MIN_BOX_SEPARATION = 12; // pixels

export function simulateMutations(
  currentElements: ExcalidrawElement[],
  mutations: PlannedMutation[]
): { allElements: ExcalidrawElement[] } {
  const map = new Map<string, ExcalidrawElement>();
  for (const el of currentElements) {
    if (!el.isDeleted) {
      map.set(el.id, JSON.parse(JSON.stringify(el)));
    }
  }

  for (const mut of mutations) {
    if (mut.op === "add") {
      map.set(mut.elementId, JSON.parse(JSON.stringify(mut.element)));
    } else if (mut.op === "delete") {
      map.delete(mut.elementId);
    } else if (mut.op === "update") {
      const existing = map.get(mut.elementId);
      if (existing) {
        const patch = { ...mut.patch };
        if (patch.appendBoundElement) {
          const currentBounds = existing.boundElements ?? [];
          if (!currentBounds.some((b) => b.id === patch.appendBoundElement!.id)) {
            existing.boundElements = [...currentBounds, patch.appendBoundElement];
          }
          delete patch.appendBoundElement;
        }
        if (patch.deltaX !== undefined) {
          existing.x = (existing.x || 0) + patch.deltaX;
          delete patch.deltaX;
        }
        if (patch.deltaY !== undefined) {
          existing.y = (existing.y || 0) + patch.deltaY;
          delete patch.deltaY;
        }
        Object.assign(existing, patch);
      }
    }
  }

  return { allElements: Array.from(map.values()) };
}

export function validateProposal(
  currentElements: ExcalidrawElement[],
  mutations: PlannedMutation[],
  options: { allowOrphanNodes?: boolean } = {}
): ValidationResult {
  const errors: string[] = [];

  if (mutations.length === 0) {
    return { valid: false, errors: ["Proposal produced zero element mutations."] };
  }

  // Apply mutations to a dry-run element map
  const simulated = simulateMutations(currentElements, mutations);

  // Check 1: Max element count per board (<= 200)
  if (simulated.allElements.length > MAX_BOARD_ELEMENTS) {
    errors.push(
      `Element cap exceeded: ${simulated.allElements.length} > ${MAX_BOARD_ELEMENTS} max elements.`
    );
  }

  const nodeMap = new Map<string, DiagramNode>();
  const edgeList: DiagramEdge[] = [];

  for (const el of simulated.allElements) {
    if (el.isDeleted) continue;
    if (el.customData?.bmKind === "node" || el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
      // If it's a node shape (not an arrow or pure text container)
      if (el.type !== "arrow" && el.type !== "text") {
        nodeMap.set(el.id, {
          id: el.id,
          label: el.customData?.label ?? "",
          nodeType: el.customData?.nodeType ?? "service",
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
        });
      }
    }
    if (el.customData?.bmKind === "edge" || el.type === "arrow") {
      const sourceId = el.startBinding?.elementId ?? el.customData?.sourceId;
      const targetId = el.endBinding?.elementId ?? el.customData?.targetId;
      edgeList.push({
        id: el.id,
        sourceId,
        targetId,
        label: (el.customData?.label ?? "").trim().toLowerCase(),
      });
    }
  }

  // Check 2 & 3: Edge referential integrity & No self-referencing edges
  const degreeMap = new Map<string, number>();
  for (const nodeId of nodeMap.keys()) {
    degreeMap.set(nodeId, 0);
  }

  const edgeSignatureSet = new Set<string>();

  for (const edge of edgeList) {
    if (!edge.sourceId || !nodeMap.has(edge.sourceId)) {
      errors.push(`Edge ${edge.id} references non-existent sourceId '${edge.sourceId}'.`);
      continue;
    }
    if (!edge.targetId || !nodeMap.has(edge.targetId)) {
      errors.push(`Edge ${edge.id} references non-existent targetId '${edge.targetId}'.`);
      continue;
    }

    // Check 3: No self-referencing edges
    if (edge.sourceId === edge.targetId) {
      errors.push(`Edge ${edge.id} is self-referencing on node '${edge.sourceId}'.`);
    }

    // Check 4: No duplicate edges (same sourceId, targetId, and normalized label)
    const sig = `${edge.sourceId}->${edge.targetId}::${edge.label}`;
    if (edgeSignatureSet.has(sig)) {
      errors.push(`Duplicate edge detected: ${sig}`);
    }
    edgeSignatureSet.add(sig);

    degreeMap.set(edge.sourceId, (degreeMap.get(edge.sourceId) ?? 0) + 1);
    degreeMap.set(edge.targetId, (degreeMap.get(edge.targetId) ?? 0) + 1);
  }

  // Check 5: No orphan nodes (unless explicitly allowed or board has <= 1 node)
  if (!options.allowOrphanNodes && nodeMap.size > 1) {
    for (const [nodeId, degree] of degreeMap.entries()) {
      if (degree === 0) {
        const label = nodeMap.get(nodeId)?.label || nodeId;
        errors.push(`Orphan node detected without edges: '${label}' (${nodeId}).`);
      }
    }
  }

  // Check 6: Layout bounding-box overlap check across all nodes
  const nodes = Array.from(nodeMap.values());
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlapX =
        a.x < b.x + b.width + MIN_BOX_SEPARATION &&
        a.x + a.width + MIN_BOX_SEPARATION > b.x;
      const overlapY =
        a.y < b.y + b.height + MIN_BOX_SEPARATION &&
        a.y + a.height + MIN_BOX_SEPARATION > b.y;

      if (overlapX && overlapY) {
        errors.push(
          `Bounding box overlap between '${a.label}' (${a.id}) and '${b.label}' (${b.id}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
