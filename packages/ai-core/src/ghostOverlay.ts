import type { ExcalidrawElement, PlannedMutation } from "./types.js";

export interface GhostOverlayResult {
  ghostElements: ExcalidrawElement[];
  centroid: { x: number; y: number };
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function generateGhostOverlay(
  mutations: PlannedMutation[],
  proposalId: string
): GhostOverlayResult {
  const ghostElements: ExcalidrawElement[] = [];

  for (const mut of mutations) {
    if (mut.op === "add") {
      const cloned: ExcalidrawElement = JSON.parse(JSON.stringify(mut.element));
      cloned.id = `ghost_${cloned.id}`;
      cloned.strokeStyle = "dashed";
      cloned.strokeColor = "#4f46e5"; // Indigo-600
      cloned.backgroundColor = "#eef2ff"; // Indigo-50
      cloned.opacity = 60;
      cloned.locked = true;
      cloned.customData = {
        ...(cloned.customData || {}),
        isGhost: true,
        proposalId,
        originalElementId: mut.elementId,
      };

      // If text container binding is present, redirect to ghost container
      if (cloned.containerId) {
        cloned.containerId = `ghost_${cloned.containerId}`;
      }
      if (cloned.boundElements) {
        cloned.boundElements = cloned.boundElements.map((b) => ({
          ...b,
          id: `ghost_${b.id}`,
        }));
      }

      ghostElements.push(cloned);
    }
  }

  // Calculate bounding box and centroid
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  if (ghostElements.length === 0) {
    return {
      ghostElements: [],
      centroid: { x: 400, y: 300 },
      boundingBox: { minX: 400, minY: 300, maxX: 400, maxY: 300 },
    };
  }

  for (const el of ghostElements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width || 0));
    maxY = Math.max(maxY, el.y + (el.height || 0));
  }

  return {
    ghostElements,
    centroid: {
      x: Math.round((minX + maxX) / 2),
      y: Math.max(20, Math.round(minY - 36)),
    },
    boundingBox: { minX, minY, maxX, maxY },
  };
}
