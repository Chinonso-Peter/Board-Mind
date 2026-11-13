"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Share2,
  Sparkles,
  MousePointer,
  Hand,
  Square,
  Diamond,
  Circle,
  ArrowRight,
  Type,
  Pencil,
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Mic,
  MicOff,
  History,
  MessageSquare,
  Send,
  X,
  Check,
  ChevronRight,
  Sparkle,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { GhostPill } from "./GhostPill";
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
      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-500 text-sm">
        <div className="flex flex-col items-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
          <span>Loading Whiteboard Canvas...</span>
        </div>
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

type ActiveTool =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "text"
  | "freedraw"
  | "eraser";

export const Canvas: React.FC<CanvasProps> = ({
  boardId,
  boardName,
  wsToken,
  currentUser,
}) => {
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>("selection");
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [aiChatOpen, setAiChatOpen] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);

  const {
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
    updateElements,
  } = useBoardSync(boardId, wsToken, currentUser);

  const { isRecording, startRecording, stopRecording } = useVoiceStream(
    boardId,
    wsToken,
    sendTextUtterance
  );

  const hasAutoFittedRef = useRef(false);
  const prevProposalCountRef = useRef(0);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const isLocalInteractingRef = useRef(false);
  const lastLocalUpdateTimestampRef = useRef<number>(0);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Automatically open AI chat on desktop screens by default, keep closed on mobile
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setAiChatOpen(true);
    }
  }, []);

  // Sync elements into Excalidraw using restoreElements and auto-center viewport
  useEffect(() => {
    // If user is actively drawing, dragging, or just edited locally (< 1200ms ago), DO NOT overwrite the scene!
    if (isLocalInteractingRef.current || Date.now() - lastLocalUpdateTimestampRef.current < 1200) {
      return;
    }

    if (excalidrawApi && elements && elements.length > 0) {
      import("@excalidraw/excalidraw").then(({ restoreElements }) => {
        try {
          const restored = restoreElements(elements as any, null);
          excalidrawApi.updateScene({ elements: restored });

          // On initial diagram load, auto-fit content so the entire architecture is centered
          if (!hasAutoFittedRef.current) {
            hasAutoFittedRef.current = true;
            setTimeout(() => {
              try {
                const sceneEls = excalidrawApi.getSceneElements();
                if (sceneEls && sceneEls.length > 0) {
                  excalidrawApi.scrollToContent(sceneEls, {
                    fitToViewport: true,
                    viewportZoomFactor: 0.82,
                    animate: false,
                  });
                }
              } catch {
                // Ignore
              }
            }, 120);
          }
        } catch {
          excalidrawApi.updateScene({ elements: elements as any });
        }
      });
    }
  }, [excalidrawApi, elements]);

  // When a new proposal arrives, automatically focus the camera on all elements including the ghost!
  useEffect(() => {
    if (excalidrawApi && proposals.length > prevProposalCountRef.current) {
      prevProposalCountRef.current = proposals.length;
      setTimeout(() => {
        try {
          const sceneEls = excalidrawApi.getSceneElements();
          if (sceneEls && sceneEls.length > 0) {
            excalidrawApi.scrollToContent(sceneEls, {
              fitToViewport: true,
              viewportZoomFactor: 0.82,
              animate: true,
            });
          }
        } catch {
          // Ignore
        }
      }, 150);
    }
  }, [excalidrawApi, proposals.length]);

  // Auto-scroll chat to bottom on new turns
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Excalidraw interactive change handler with local persistence to Yjs
  const handleExcalidrawChange = useCallback(
    (newElements: readonly any[], appState: any) => {
      // Sync tool indicator state
      if (appState?.activeTool?.type && appState.activeTool.type !== activeTool) {
        setActiveTool(appState.activeTool.type as ActiveTool);
      }
      if (appState?.zoom?.value) {
        setZoomPercent(Math.round(appState.zoom.value * 100));
      }

      // Mark local interaction active
      isLocalInteractingRef.current = true;
      lastLocalUpdateTimestampRef.current = Date.now();

      // Clear previous save debounce
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce saving canonical elements to Yjs
      saveTimeoutRef.current = setTimeout(() => {
        if (newElements && newElements.length > 0) {
          updateElements(newElements);
        }
        setTimeout(() => {
          if (Date.now() - lastLocalUpdateTimestampRef.current >= 400) {
            isLocalInteractingRef.current = false;
          }
        }, 300);
      }, 350);
    },
    [activeTool, updateElements]
  );

  const selectTool = (tool: ActiveTool) => {
    setActiveTool(tool);
    if (!excalidrawApi) return;
    try {
      excalidrawApi.setActiveTool({ type: tool, locked: false });
      if (typeof excalidrawApi.focusContainer === "function") {
        excalidrawApi.focusContainer();
      }
    } catch (err) {
      console.warn("Tool selection error:", err);
    }
  };

  const handleZoomToFit = () => {
    if (!excalidrawApi) return;
    try {
      const sceneEls = excalidrawApi.getSceneElements();
      if (sceneEls && sceneEls.length > 0) {
        excalidrawApi.scrollToContent(sceneEls, {
          fitToViewport: true,
          viewportZoomFactor: 0.82,
          animate: true,
        });
      }
    } catch (err) {
      console.warn("Zoom to fit error:", err);
    }
  };

  const handleZoomIn = () => {
    if (!excalidrawApi) return;
    const appState = excalidrawApi.getAppState();
    const currentZoom = appState?.zoom?.value || 1;
    const nextZoom = Math.min(currentZoom + 0.2, 3);
    excalidrawApi.updateScene({
      appState: { zoom: { value: nextZoom } },
    });
    setZoomPercent(Math.round(nextZoom * 100));
  };

  const handleZoomOut = () => {
    if (!excalidrawApi) return;
    const appState = excalidrawApi.getAppState();
    const currentZoom = appState?.zoom?.value || 1;
    const nextZoom = Math.max(currentZoom - 0.2, 0.2);
    excalidrawApi.updateScene({
      appState: { zoom: { value: nextZoom } },
    });
    setZoomPercent(Math.round(nextZoom * 100));
  };

  const handleUndo = () => {
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })
      );
    }
  };

  const handleRedo = () => {
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true })
      );
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    sendTextUtterance(chatInput.trim());
    setChatInput("");
  };

  const handleTriggerQuickSuggestion = (text: string) => {
    sendTextUtterance(text);
  };

  const handleShare = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleExport = async (format: "png" | "svg") => {
    if (!excalidrawApi) return;
    try {
      const exportElements = excalidrawApi.getSceneElements();
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
    <div className="relative w-screen h-screen h-[100dvh] overflow-hidden bg-[#fafafa] select-none flex">
      {/* 1. Whiteboard Canvas Workspace */}
      <div className="flex-1 h-full relative overflow-hidden bg-white">
        <div className="absolute inset-0">
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawApi(api)}
            onChange={handleExcalidrawChange}
            initialData={{
              elements: (elements || []) as any,
              appState: {
                viewBackgroundColor: "#ffffff",
                gridSize: 20,
              },
            }}
            zenModeEnabled={false}
            viewModeEnabled={false}
            gridModeEnabled={true}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
            }}
          />
        </div>

        {/* 2. Top-Left Floating Header Pill */}
        <div className="absolute top-2.5 left-2.5 sm:top-4 sm:left-4 z-30 flex items-center bg-white/95 backdrop-blur-md rounded-2xl shadow-sm border border-slate-200/80 px-2.5 sm:px-3 py-1.5 space-x-1.5 sm:space-x-2">
          <Link
            href="/"
            title="Back to Dashboard"
            className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div className="flex items-center space-x-1 font-extrabold text-slate-900 text-xs sm:text-sm tracking-tight pr-0.5">
            <span className="text-amber-500 text-sm sm:text-base">✦</span>
            <span>BoardMind</span>
          </div>

          <div className="h-3.5 w-px bg-slate-200" />

          <span
            className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate max-w-[90px] sm:max-w-xs"
            title={boardName}
          >
            {boardName}
          </span>

          <div className="h-3.5 w-px bg-slate-200" />

          <button
            onClick={() => handleExport("png")}
            title="Export PNG Diagram"
            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 3. Top-Right Floating Actions Pill */}
        <div className="absolute top-2.5 right-2.5 sm:top-4 sm:right-4 z-30 flex items-center bg-white/95 backdrop-blur-md rounded-2xl shadow-sm border border-slate-200/80 p-1 sm:p-1.5 space-x-1 sm:space-x-2">
          {/* Live Voice Streaming Toggle */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            title={isRecording ? "Stop Voice Review" : "Start Voice Review Stream"}
            className={`flex items-center space-x-1 px-2 sm:px-2.5 py-1 rounded-xl text-[11px] sm:text-xs font-semibold transition-all touch-manipulation ${
              isRecording
                ? "bg-rose-500 text-white animate-pulse shadow-xs"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-indigo-600" />}
            <span className="hidden sm:inline">{isRecording ? "Listening..." : "Voice"}</span>
          </button>

          {/* Checkpoints / History */}
          <button
            onClick={() => setTimelineOpen(!timelineOpen)}
            title="Version Checkpoints History"
            className={`p-1.5 rounded-xl text-xs font-medium transition-colors ${
              timelineOpen
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <History className="w-4 h-4" />
          </button>

          {/* Collaborator Avatar */}
          <div
            title={`${currentUser.name} (${collaborators.length} online)`}
            className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-indigo-600 text-white font-bold text-[10px] sm:text-xs flex items-center justify-center shadow-xs cursor-pointer"
          >
            {currentUser.name.charAt(0).toUpperCase()}
          </div>

          {/* Share Button */}
          <button
            onClick={handleShare}
            className="flex items-center space-x-1 px-2.5 sm:px-3 py-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{copiedLink ? "Copied!" : "Share"}</span>
          </button>
        </div>

        {/* 4. Left Vertical Floating Toolbar (Iconic Whiteboard Toolbar) */}
        <div className="absolute left-2.5 top-16 sm:left-4 sm:top-24 z-30 flex flex-col items-center space-y-1.5 sm:space-y-2 pointer-events-auto">
          {/* Main Drawing Tools Column */}
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-md border border-slate-200/90 p-1 sm:p-1.5 flex flex-col space-y-0.5 sm:space-y-1">
            {/* BoardMind Yellow AI Button at Top */}
            <button
              onClick={() => setAiChatOpen(!aiChatOpen)}
              title="Toggle BoardMind AI Architecture Reviewer Panel"
              className={`p-1.5 sm:p-2 rounded-xl transition-all touch-manipulation cursor-pointer ${
                aiChatOpen
                  ? "bg-amber-400 text-slate-900 shadow-sm font-bold"
                  : "bg-amber-100 hover:bg-amber-300 text-amber-900"
              }`}
            >
              <Sparkles className="w-4 h-4" />
            </button>

            <div className="w-full h-px bg-slate-200 my-0.5" />

            {/* Selection Tool */}
            <button
              onClick={() => selectTool("selection")}
              title="Select / Move (V)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "selection"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <MousePointer className="w-4 h-4" />
            </button>

            {/* Hand / Pan Tool */}
            <button
              onClick={() => selectTool("hand")}
              title="Hand / Pan Canvas (H)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "hand"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Hand className="w-4 h-4" />
            </button>

            {/* Rectangle Node Tool */}
            <button
              onClick={() => selectTool("rectangle")}
              title="Rectangle Service Node (R)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "rectangle"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Square className="w-4 h-4" />
            </button>

            {/* Diamond Gateway Node Tool */}
            <button
              onClick={() => selectTool("diamond")}
              title="Diamond Gateway Node (D)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "diamond"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Diamond className="w-4 h-4" />
            </button>

            {/* Ellipse Tool */}
            <button
              onClick={() => selectTool("ellipse")}
              title="Ellipse Database Node (O)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "ellipse"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Circle className="w-4 h-4" />
            </button>

            {/* Arrow / Connector Tool */}
            <button
              onClick={() => selectTool("arrow")}
              title="Arrow Connector (A)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "arrow"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* Text Tool */}
            <button
              onClick={() => selectTool("text")}
              title="Text Label (T)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "text"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Type className="w-4 h-4" />
            </button>

            {/* Free Draw Pen */}
            <button
              onClick={() => selectTool("freedraw")}
              title="Draw / Pen (P)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "freedraw"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>

            {/* Eraser Tool */}
            <button
              onClick={() => selectTool("eraser")}
              title="Eraser (E)"
              className={`p-1.5 sm:p-2 rounded-xl transition-colors touch-manipulation cursor-pointer ${
                activeTool === "eraser"
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>

          {/* Undo / Redo Small Floating Pill */}
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-md border border-slate-200/90 p-1 flex items-center space-x-0.5 sm:space-x-1">
            <button
              onClick={handleUndo}
              title="Undo (Ctrl+Z)"
              className="p-1 sm:p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors touch-manipulation"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              title="Redo (Ctrl+Y)"
              className="p-1 sm:p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors touch-manipulation"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 5. Bottom-Right Floating Zoom / Viewport Controls */}
        <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-6 z-30 flex items-center bg-white/95 backdrop-blur-md rounded-2xl shadow-md border border-slate-200/90 px-1.5 sm:px-2 py-1 space-x-1 text-xs text-slate-700">
          <button
            onClick={handleZoomToFit}
            title="Fit Diagram to Screen"
            className="p-1 sm:p-1.5 hover:bg-slate-100 active:bg-slate-200 rounded-lg text-slate-700 transition-colors touch-manipulation"
          >
            <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={handleZoomOut}
            title="Zoom Out"
            className="p-1 sm:p-1.5 hover:bg-slate-100 active:bg-slate-200 rounded-lg text-slate-700 transition-colors touch-manipulation"
          >
            <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <span className="font-semibold text-slate-800 text-[11px] sm:text-xs min-w-[32px] sm:min-w-[36px] text-center select-none">
            {zoomPercent}%
          </span>

          <button
            onClick={handleZoomIn}
            title="Zoom In"
            className="p-1 sm:p-1.5 hover:bg-slate-100 active:bg-slate-200 rounded-lg text-slate-700 transition-colors touch-manipulation"
          >
            <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* 6. Mobile Floating AI Chat Trigger Button (When chat is closed on mobile) */}
        {!aiChatOpen && (
          <div className="md:hidden absolute bottom-3 left-3 z-30 pointer-events-auto">
            <button
              onClick={() => setAiChatOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-400 active:bg-amber-500 text-slate-900 font-bold text-xs rounded-2xl shadow-lg border border-amber-300 touch-manipulation"
            >
              <Sparkles className="w-4 h-4" />
              <span>AI Chat</span>
              {transcript.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-indigo-600" />
              )}
            </button>
          </div>
        )}

        {/* 7. Active Ghost Proposal Review Card (Prominent Non-Destructive Banner) */}
        {proposals.map((proposal) => (
          <GhostPill
            key={proposal.id}
            proposal={proposal}
            onApprove={approveProposal}
            onDismiss={dismissProposal}
          />
        ))}
      </div>

      {/* 8. Right Side AI Architecture Reviewer Panel (Responsive Desktop Sidebar & Mobile Drawer) */}
      {aiChatOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 md:static md:w-80 lg:w-96 h-full bg-white border-l border-slate-200 shadow-2xl md:shadow-xl flex flex-col z-30 shrink-0 animate-in slide-in-from-right duration-200">
          {/* Panel Header */}
          <div className="h-12 border-b border-slate-200 px-4 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-lg bg-amber-400 flex items-center justify-center text-slate-900 shadow-2xs font-extrabold text-xs">
                ✦
              </div>
              <div>
                <h3 className="font-bold text-xs text-slate-800">BoardMind AI Reviewer</h3>
                <span className="text-[10px] text-slate-400 block -mt-0.5">
                  Passive Design Review & Suggestions
                </span>
              </div>
            </div>

            <button
              onClick={() => setAiChatOpen(false)}
              title="Close AI Panel"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Quick Decision Starters */}
          <div className="p-3 bg-slate-50 border-b border-slate-100 space-y-2 shrink-0">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              Quick Decision Suggestions:
            </span>
            <div className="space-y-1.5">
              <button
                onClick={() =>
                  handleTriggerQuickSuggestion(
                    "Let's add a Redis cache in front of PostgreSQL to cache active checkout sessions."
                  )
                }
                className="w-full text-left p-2 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-300 transition-all text-xs font-medium text-slate-700 hover:text-indigo-700 flex items-center justify-between shadow-2xs touch-manipulation cursor-pointer"
              >
                <span>➕ Add Redis Cache (Sessions)</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() =>
                  handleTriggerQuickSuggestion(
                    "We should introduce a Kafka message queue between Checkout Service and Order Fulfillment."
                  )
                }
                className="w-full text-left p-2 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-300 transition-all text-xs font-medium text-slate-700 hover:text-indigo-700 flex items-center justify-between shadow-2xs touch-manipulation cursor-pointer"
              >
                <span>➕ Add Kafka Message Queue</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() =>
                  handleTriggerQuickSuggestion(
                    "Let's add an Auth Service connected to API Gateway for user authentication."
                  )
                }
                className="w-full text-left p-2 rounded-xl bg-white hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-300 transition-all text-xs font-medium text-slate-700 hover:text-indigo-700 flex items-center justify-between shadow-2xs touch-manipulation cursor-pointer"
              >
                <span>➕ Add Auth Microservice</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Conversation Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 touch-scroll">
            {transcript.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-6 space-y-2">
                <Sparkles className="w-8 h-8 text-amber-400 opacity-60" />
                <p className="font-semibold text-xs text-slate-600">Passive Architecture Review</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Type a decision or talk via Voice stream. BoardMind AI listens and automatically creates ghost overlays on your whiteboard!
                </p>
              </div>
            ) : (
              transcript.map((turn) => {
                const isUser = turn.speakerId === currentUser.id;
                const isAi = turn.speakerId === "agent_boardmind" || (turn.speakerName || "").toLowerCase().includes("ai");
                return (
                  <div
                    key={turn.id}
                    className={`flex flex-col space-y-1 ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 px-1">
                      <span className={`font-semibold ${isAi ? "text-amber-600" : "text-slate-600"}`}>
                        {turn.speakerName}
                      </span>
                      <span>•</span>
                      <span>{new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div
                      className={`p-3 rounded-2xl text-xs max-w-[88%] leading-relaxed shadow-2xs ${
                        isUser
                          ? "bg-indigo-600 text-white rounded-br-xs"
                          : isAi
                          ? "bg-amber-50/90 border border-amber-200/70 text-slate-800 rounded-bl-xs"
                          : "bg-slate-100 text-slate-800 rounded-bl-xs"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{turn.text}</div>
                      {isAi && proposals.length > 0 && turn.text.includes("ghost overlay") && (
                        <div className="mt-2.5 pt-2 border-t border-amber-200/60 flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => approveProposal(proposals[0].id)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-xs transition-all text-xs cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Approve & Add to Diagram</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissProposal(proposals[0].id)}
                            className="px-2 py-1.5 hover:bg-amber-100 text-slate-500 hover:text-slate-700 rounded-xl transition-colors text-xs cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* AI Thinking Notice */}
          {aiStatus && (
            <div className="px-4 py-1.5 bg-amber-50 border-t border-amber-200/60 flex items-center space-x-2 text-[11px] text-amber-800 font-semibold animate-pulse shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-spin" />
              <span>BoardMind AI analyzing architectural impact...</span>
            </div>
          )}

          {/* Bottom Chat Input Form */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-slate-200 bg-white shrink-0"
          >
            <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:border-indigo-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <input
                type="text"
                placeholder="Where shall we start? (e.g. Add Redis...)"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 bg-transparent px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
              />

              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                title={isRecording ? "Stop voice recording" : "Record voice remark"}
                className={`p-1.5 rounded-xl transition-colors touch-manipulation ${
                  isRecording
                    ? "bg-rose-500 text-white animate-pulse"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>

              <button
                type="submit"
                disabled={!chatInput.trim()}
                title="Send remark to AI"
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white rounded-xl transition-colors ml-1 touch-manipulation"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </aside>
      )}

      {/* Slide-over Checkpoint History Drawer */}
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
