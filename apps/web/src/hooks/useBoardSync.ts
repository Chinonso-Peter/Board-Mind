import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import type { ExcalidrawElement, ProposalRecord, TranscriptTurn } from "@boardmind/ai-core";
import { useUIStore } from "../stores/uiStore";

export interface ActiveGhostProposal {
  id: string;
  decisionSummary: string;
  confidence: number;
  ghostElements: ExcalidrawElement[];
  centroid: { x: number; y: number };
}

// Helper to identify ephemeral ghost elements
function isGhostItem(el: any): boolean {
  if (!el || !el.id) return false;
  if (typeof el.id === "string" && el.id.startsWith("ghost_")) return true;
  if (el.customData?.isGhost === true) return true;
  if (el.customData?.proposalId) return true;
  if (el.customData?.status === "proposed" || el.customData?.ghostId) return true;
  return false;
}

export function useBoardSync(boardId: string, wsToken?: string, currentUser?: { id: string; name: string }) {
  const [doc] = useState(() => new Y.Doc());
  const [elements, setElements] = useState<ExcalidrawElement[]>([]);
  const [proposals, setProposals] = useState<ActiveGhostProposal[]>([]);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [collaborators, setCollaborators] = useState<Array<{ id: string; name: string; speaking?: boolean }>>([]);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const providerRef = useRef<WebsocketProvider | null>(null);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);

  const { isOffline, setIsOffline, isScrubbing, previewElements, setAiNotice } = useUIStore();

  // Initialize Yjs and providers
  useEffect(() => {
    if (typeof window === "undefined" || !boardId) return;

    // 1. IndexedDB persistence for offline and instant paint
    const idb = new IndexeddbPersistence(`boardmind:${boardId}`, doc);
    persistenceRef.current = idb;

    // 2. WebSocket sync - dynamically resolve hostname to support PC localhost and Mobile private IP
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host =
      window.location.port === "3000"
        ? `${window.location.hostname}:4000`
        : (process.env.NEXT_PUBLIC_WS_HOST || `${window.location.hostname}:4000`);
    const wsUrl = `${proto}//${host}/ws/sync`;

    const provider = new WebsocketProvider(wsUrl, boardId, doc, {
      params: wsToken ? { token: wsToken } : {},
      connect: true,
    });
    providerRef.current = provider;

    provider.on("status", (event: { status: "connected" | "connecting" | "disconnected" }) => {
      setIsOffline(event.status !== "connected");
    });

    const updateOnline = () => {
      setIsOffline(!navigator.onLine);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    // Awareness setup
    const awareness = provider.awareness;
    if (currentUser) {
      awareness.setLocalStateField("user", {
        id: currentUser.id,
        name: currentUser.name,
      });
    }

    awareness.on("change", () => {
      const states = awareness.getStates();
      const users: Array<{ id: string; name: string; speaking?: boolean }> = [];
      let currentAiStatus: string | null = null;

      states.forEach((state: any) => {
        if (state.user) {
          users.push({
            id: state.user.id,
            name: state.user.name,
            speaking: state.speaking,
          });
        }
        if (state.aiStatus) {
          currentAiStatus = state.aiStatus;
        }
      });

      setCollaborators(users);
      setAiStatus(currentAiStatus);
    });

    // Recompute elements + ghosts
    const syncState = () => {
      const elementsArray = doc.getArray("elements");
      const canonical: ExcalidrawElement[] = [];
      let hadCorruptGhosts = false;

      for (let i = 0; i < elementsArray.length; i++) {
        const item: any = elementsArray.get(i);
        const el = typeof item?.toJSON === "function" ? item.toJSON() : item;
        if (!el || !el.id || el.isDeleted) continue;
        if (isGhostItem(el)) {
          hadCorruptGhosts = true;
          continue;
        }
        // Ensure canonical elements are always unlocked and editable
        if (el.locked) {
          el.locked = false;
        }
        canonical.push(el);
      }

      // Purge any leaked ghost elements from the permanent Yjs array
      if (hadCorruptGhosts) {
        doc.transact(() => {
          elementsArray.delete(0, elementsArray.length);
          for (const c of canonical) {
            elementsArray.push([c]);
          }
        }, "clean-corrupt-ghosts");
      }

      // Check proposals for active ghost overlays
      const proposalsMap = doc.getMap("proposals");
      const activeGhosts: ActiveGhostProposal[] = [];
      const ghostElements: ExcalidrawElement[] = [];

      proposalsMap.forEach((val: any) => {
        const prop = typeof val.toJSON === "function" ? val.toJSON() : val;
        if (prop.status === "pending" && prop.ghostElementsJson) {
          try {
            const parsedGhosts: ExcalidrawElement[] = JSON.parse(prop.ghostElementsJson);
            ghostElements.push(...parsedGhosts);

            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            for (const g of parsedGhosts) {
              minX = Math.min(minX, g.x);
              minY = Math.min(minY, g.y);
              maxX = Math.max(maxX, g.x + (g.width || 0));
            }

            activeGhosts.push({
              id: prop.id,
              decisionSummary: prop.decisionSummary,
              confidence: prop.confidence,
              ghostElements: parsedGhosts,
              centroid: {
                x: Math.round((minX + maxX) / 2) || 400,
                y: Math.max(20, Math.round(minY - 36)) || 200,
              },
            });
          } catch {
            // Ignore malformed proposal
          }
        }
      });

      setProposals(activeGhosts);
      setElements([...canonical, ...ghostElements]);

      // Update transcript
      const transcriptArray = doc.getArray("transcript");
      const turns: TranscriptTurn[] = [];
      for (let i = 0; i < transcriptArray.length; i++) {
        const t: any = transcriptArray.get(i);
        turns.push(typeof t?.toJSON === "function" ? t.toJSON() : t);
      }
      setTranscript(turns);
    };

    const onProviderSynced = (isSynced: boolean) => {
      if (isSynced) {
        syncState();
      }
    };

    doc.getArray("elements").observe(syncState);
    doc.getMap("proposals").observe(syncState);
    doc.getArray("transcript").observe(syncState);
    doc.on("update", syncState);
    idb.on("synced", syncState);
    provider.on("sync", onProviderSynced);

    // Initial check
    syncState();

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      try {
        doc.getArray("elements").unobserve(syncState);
        doc.getMap("proposals").unobserve(syncState);
        doc.getArray("transcript").unobserve(syncState);
        doc.off("update", syncState);
      } catch {
        // Safe cleanup
      }
      try {
        provider.off("sync", onProviderSynced);
        provider.destroy();
      } catch {
        // Safe cleanup
      }
      try {
        idb.destroy();
      } catch {
        // Safe cleanup
      }
    };
  }, [boardId, wsToken, currentUser, doc, setIsOffline]);

  const approveProposal = useCallback(
    (proposalId: string) => {
      if (providerRef.current?.ws && providerRef.current.ws.readyState === WebSocket.OPEN) {
        providerRef.current.ws.send(
          JSON.stringify({
            type: "APPROVE_PROPOSAL",
            proposalId,
          })
        );
      }
    },
    []
  );

  const dismissProposal = useCallback(
    (proposalId: string) => {
      if (providerRef.current?.ws && providerRef.current.ws.readyState === WebSocket.OPEN) {
        providerRef.current.ws.send(
          JSON.stringify({
            type: "DISMISS_PROPOSAL",
            proposalId,
          })
        );
      }
    },
    []
  );

  const sendTextUtterance = useCallback(
    (text: string) => {
      if (!text.trim() || !currentUser) return;
      const transcriptArray = doc.getArray("transcript");
      const turnMap = new Y.Map();
      turnMap.set("id", `turn_${Math.random().toString(36).slice(2, 9)}`);
      turnMap.set("speakerId", currentUser.id);
      turnMap.set("speakerName", currentUser.name);
      turnMap.set("text", text.trim());
      turnMap.set("timestamp", Date.now());
      turnMap.set("source", "text");
      turnMap.set("processedByAgent", false);

      doc.transact(() => {
        transcriptArray.push([turnMap]);
      });
    },
    [doc, currentUser]
  );

  const updateElements = useCallback(
    (newElements: readonly any[]) => {
      if (!doc || isScrubbing) return;

      // Filter out ephemeral ghost overlay elements and deleted shapes
      const canonical = newElements
        .filter((el) => {
          if (!el || !el.id || el.isDeleted) return false;
          if (typeof el.id === "string" && el.id.startsWith("ghost_")) return false;
          if (el.customData?.isGhost === true) return false;
          if (el.customData?.proposalId) return false;
          if (el.customData?.status === "proposed" || el.customData?.ghostId) return false;
          return true;
        })
        .map((el) => {
          // Guarantee all canonical elements on the whiteboard are unlocked and editable
          if (el.locked) {
            return { ...el, locked: false };
          }
          return el;
        });

      const yArray = doc.getArray("elements");

      // CRITICAL GUARD: Never wipe existing canonical elements from Yjs when local state
      // temporarily reports 0 elements (e.g. during initial mount, scene reset, tab switch,
      // unhydrated canvas, or ghost overlay filtering).
      // Only allow emptying the array if the user explicitly deleted shapes on canvas
      // (in which case Excalidraw passes elements with `isDeleted: true`).
      if (canonical.length === 0 && yArray.length > 0) {
        const hasExplicitDeletions = newElements.some((el: any) => el && el.isDeleted === true);
        if (!hasExplicitDeletions) {
          return;
        }
      }

      // If user elements match what is already in Yjs, avoid redundant transaction
      if (canonical.length === yArray.length && yArray.length > 0) {
        let isIdentical = true;
        for (let i = 0; i < yArray.length; i++) {
          const item: any = yArray.get(i);
          const rawId = item?.get ? item.get("id") : item?.id;
          const rawVer = item?.get ? item.get("version") : item?.version;
          if (rawId !== canonical[i]?.id || rawVer !== canonical[i]?.version) {
            isIdentical = false;
            break;
          }
        }
        if (isIdentical) return;
      }

      doc.transact(() => {
        yArray.delete(0, yArray.length);
        for (const el of canonical) {
          yArray.push([el]);
        }
      }, "local-canvas-edit");
    },
    [doc, isScrubbing]
  );

  // When timeline scrubber is active, display snapshot preview elements instead
  const displayedElements = isScrubbing && previewElements ? previewElements : elements;

  return {
    doc,
    elements: displayedElements,
    proposals,
    transcript,
    collaborators,
    aiStatus,
    isOffline,
    approveProposal,
    dismissProposal,
    sendTextUtterance,
    updateElements,
  };
}
