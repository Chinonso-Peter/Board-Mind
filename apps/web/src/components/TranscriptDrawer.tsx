import React, { useState, useRef, useEffect } from "react";
import { X, Send, Mic, MessageSquare, Sparkles } from "lucide-react";
import type { TranscriptTurn } from "@boardmind/ai-core";
import { useUIStore } from "../stores/uiStore";

interface TranscriptDrawerProps {
  transcript: TranscriptTurn[];
  onSendUtterance: (text: string) => void;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  transcript,
  onSendUtterance,
}) => {
  const { transcriptOpen, setTranscriptOpen } = useUIStore();
  const [inputText, setInputText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptOpen) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript.length, transcriptOpen]);

  if (!transcriptOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendUtterance(inputText);
      setInputText("");
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 sm:top-0 sm:left-auto sm:right-0 sm:w-96 z-50 bg-white sm:border-l border-slate-200 shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none transition-all touch-scroll animate-in slide-in-from-bottom sm:slide-in-from-right duration-200">
      {/* Mobile Top Drag Indicator */}
      <div className="sm:hidden flex justify-center pt-2 pb-1">
        <div className="w-10 h-1 bg-slate-200 rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 sm:py-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-4 h-4 text-indigo-600" />
          <h3 className="font-semibold text-sm text-slate-800">Design Review Transcript</h3>
        </div>
        <button
          onClick={() => setTranscriptOpen(false)}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 touch-manipulation"
          title="Close drawer"
        >
          <X className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Transcript Turns List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 touch-scroll">
        {transcript.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            <Mic className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <span>Turn on microphone or type below to log architectural discussions.</span>
          </div>
        ) : (
          transcript.map((turn) => {
            const timeStr = new Date(turn.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={turn.id}
                className={`p-2.5 rounded-lg border text-xs ${
                  turn.processedByAgent
                    ? "bg-slate-50 border-slate-200"
                    : "bg-indigo-50/50 border-indigo-100"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-slate-700">{turn.speakerName}</span>
                    <span className="text-[10px] text-slate-400">({turn.source})</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {turn.processedByAgent && (
                      <span title="Evaluated by AI Agent">
                        <Sparkles className="w-2.5 h-2.5 text-indigo-500" />
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">{timeStr}</span>
                  </div>
                </div>
                <p className="text-slate-800 leading-relaxed">{turn.text}</p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Quick Simulation Prompts */}
      <div className="p-3 bg-slate-50 border-t border-slate-200">
        <div className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center space-x-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>Simulate Design Review Decisions:</span>
        </div>
        <div className="flex flex-col space-y-1.5">
          <button
            type="button"
            onClick={() => onSendUtterance("Let's add a Redis cache in front of PostgreSQL to cache active checkout sessions.")}
            className="text-left text-[11px] px-2.5 py-1.5 bg-white hover:bg-indigo-50 hover:border-indigo-300 border border-slate-200 rounded-md text-slate-700 transition-colors shadow-2xs font-medium"
          >
            💡 "Add Redis cache in front of PostgreSQL"
          </button>
          <button
            type="button"
            onClick={() => onSendUtterance("We should introduce a Kafka message queue between Checkout Service and Order Fulfillment.")}
            className="text-left text-[11px] px-2.5 py-1.5 bg-white hover:bg-indigo-50 hover:border-indigo-300 border border-slate-200 rounded-md text-slate-700 transition-colors shadow-2xs font-medium"
          >
            💡 "Add Kafka queue for async orders"
          </button>
          <button
            type="button"
            onClick={() => onSendUtterance("Let's add an Auth Service connected to API Gateway.")}
            className="text-left text-[11px] px-2.5 py-1.5 bg-white hover:bg-indigo-50 hover:border-indigo-300 border border-slate-200 rounded-md text-slate-700 transition-colors shadow-2xs font-medium"
          >
            💡 "Add Auth Service to API Gateway"
          </button>
        </div>
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-100 bg-white flex items-center space-x-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type an architectural decision..."
          className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors shadow-sm"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
