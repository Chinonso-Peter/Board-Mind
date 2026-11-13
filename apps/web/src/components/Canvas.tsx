"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { History, MessageSquare, Download } from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { GhostPill } from "./GhostPill";
import { AwarenessBar } from "./AwarenessBar";
import { VoiceRecorder } from "./VoiceRecorder";
import { TranscriptDrawer } from "./TranscriptDrawer";
import { TimelineScrubber } from "./TimelineScrubber";
import { OfflineBadge } from "./OfflineBadge";
import { useBoardSync } from "../hooks/useBoardSync";
import { useVoiceStream } from "../hooks/useVoiceStream";
import type { ExcalidrawElement } from "@boardmind/ai-core";

// Dynamically import Excalidraw to ensure client-side only execution
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Loading Excalidraw Canvas...
      </div>
    ),
  }
);

interface CanvasProps {
  boardId: string;
  boardName: string;
  wsToken?: string;
  currentUser: { id: string; name: string };
}

export const Canvas: React.FC<CanvasProps> = ({
  boardId,
  boardName,
  wsToken,
  currentUser,
}) => {
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const {
    transcriptOpen,
    setTranscriptOpen,
    timelineOpen,
    setTimelineOpen,
    isOffline,
  } = useUIStore();

  const {
    elements,
    proposals,
    transcript,
    collaborators,
    aiStatus,
    approveProposal,
    dismissProposal,
    sendTextUtterance,
  } = useBoardSync(boardId, wsToken, currentUser);

  const { isRecording, startRecording, stopRecording } = useVoiceStream(
    boardId,
    wsToken
  );

  // Sync elements into Excalidraw when changed
  useEffect(() => {
    if (excalidrawApi && elements) {
      excalidrawApi.updateScene({ elements: elements as any });
    }
  }, [excalidrawApi, elements]);

  const handleExport = async (format: "png" | "svg") => {
    if (!excalidrawApi) return;
    try {
      const exportElements = excalidrawApi.getSceneElements();
      const appState = excalidrawApi.getAppState();

      // Simple mock base64 export representation
      const payload = {
        format,
        dataBase64: Buffer.from(JSON.stringify(exportElements)).toString("base64"),
      };

      const res = await fetch(`/api/boards/${boardId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert(`${format.toUpperCase()} export saved to board archive successfully!`);
      }
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white select-none">
      {/* Top Header Navigation */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-2.5 bg-white/90 backdrop-blur border-b border-slate-200 shadow-xs pointer-events-auto">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              BM
            </div>
            <span className="font-bold text-slate-800 text-sm tracking-tight">BoardMind</span>
          </div>

          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-xs font-semibold text-slate-600 truncate max-w-xs">{boardName}</h1>
        </div>

        {/* Center: Awareness & AI Presence */}
        <div className="flex items-center space-x-3">
          <AwarenessBar collaborators={collaborators} aiStatus={aiStatus} />
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center space-x-2">
          {/* Live Audio Streaming */}
          <VoiceRecorder
            isRecording={isRecording}
            onToggleRecording={isRecording ? stopRecording : startRecording}
          />

          <div className="h-4 w-px bg-slate-200" />

          {/* Transcript Drawer Toggle */}
          <button
            onClick={() => setTranscriptOpen(!transcriptOpen)}
            title="Toggle Live Review Transcript"
            className={`relative flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              transcriptOpen
                ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Transcript</span>
            {transcript.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
            )}
          </button>

          {/* Timeline Scrubber Toggle */}
          <button
            onClick={() => setTimelineOpen(!timelineOpen)}
            title="Toggle Version History & Time-Travel"
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              timelineOpen
                ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
          </button>

          {/* Export Button */}
          <button
            onClick={() => handleExport("png")}
            title="Export Diagram PNG"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* Main Excalidraw Canvas */}
      <div className="w-full h-full pt-12">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawApi(api)}
          initialData={{
            elements: (elements || []) as any,
            appState: {
              viewBackgroundColor: "#ffffff",
              gridSize: 20,
            },
          }}
        />
      </div>

      {/* Floating Ghost Overlay Proposal Pills */}
      {proposals.map((proposal) => (
        <GhostPill
          key={proposal.id}
          proposal={proposal}
          onApprove={approveProposal}
          onDismiss={dismissProposal}
        />
      ))}

      {/* Slide-over Drawers */}
      <TranscriptDrawer
        transcript={transcript}
        onSendUtterance={sendTextUtterance}
      />

      <TimelineScrubber
        boardId={boardId}
        onRestoreSuccess={() => {
          // Handled via CRDT update
        }}
      />

      {/* Offline Status Badge */}
      <OfflineBadge isOffline={isOffline} />
    </div>
  );
};
