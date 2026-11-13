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

    // 2. WebSocket sync
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
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
      for (let i = 0; i < elementsArray.length; i++) {
        const item: any = elementsArray.get(i);
        canonical.push(typeof item?.toJSON === "function" ? item.toJSON() : item);
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

    doc.getArray("elements").observe(syncState);
    doc.getMap("proposals").observe(syncState);
    doc.getArray("transcript").observe(syncState);
    idb.on("synced", syncState);

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      provider.destroy();
      idb.destroy();
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
  };
}
