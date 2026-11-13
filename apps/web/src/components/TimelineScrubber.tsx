import React, { useState, useEffect } from "react";
import { History, RotateCcw, X, Eye, EyeOff } from "lucide-react";
import * as Y from "yjs";
import { useUIStore } from "../stores/uiStore";

interface CheckpointItem {
  id: string;
  label: string;
  trigger: string;
  createdAt: number;
}

interface TimelineScrubberProps {
  boardId: string;
  onRestoreSuccess?: () => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ boardId, onRestoreSuccess }) => {
  const {
    timelineOpen,
    setTimelineOpen,
    isScrubbing,
    setIsScrubbing,
    setPreviewElements,
  } = useUIStore();

  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [selectedCkptId, setSelectedCkptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCheckpoints = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/boards/${boardId}/checkpoints`);
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(data.checkpoints || []);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (timelineOpen) {
      fetchCheckpoints();
    }
  }, [timelineOpen, boardId]);

  const handlePreviewCheckpoint = async (ckptId: string) => {
    if (selectedCkptId === ckptId && isScrubbing) {
      // Exit preview
      setIsScrubbing(false);
      setPreviewElements(null);
      setSelectedCkptId(null);
      return;
    }

    try {
      const res = await fetch(`/api/boards/${boardId}/checkpoints/${ckptId}/state`);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const tempDoc = new Y.Doc();
        Y.applyUpdate(tempDoc, new Uint8Array(arrayBuffer));
        const elements = tempDoc.getArray("elements").toJSON();

        setPreviewElements(elements as any);
        setIsScrubbing(true);
        setSelectedCkptId(ckptId);
      }
    } catch (err: any) {
      console.warn("Error previewing checkpoint:", err.message);
    }
  };

  const handleRestoreCheckpoint = async (ckptId: string) => {
    if (!confirm("Are you sure you want to restore this version? This will update the live board.")) {
      return;
    }

    try {
      const res = await fetch(`/api/boards/${boardId}/checkpoints/${ckptId}/restore`, {
        method: "POST",
      });
      if (res.ok) {
        setIsScrubbing(false);
        setPreviewElements(null);
        setSelectedCkptId(null);
        setTimelineOpen(false);
        if (onRestoreSuccess) onRestoreSuccess();
      }
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    }
  };

  if (!timelineOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 sm:top-0 sm:left-auto sm:right-0 sm:w-96 z-50 bg-white sm:border-l border-slate-200 shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none transition-all touch-scroll animate-in slide-in-from-bottom sm:slide-in-from-right duration-200">
      {/* Mobile Top Drag Indicator */}
      <div className="sm:hidden flex justify-center pt-2 pb-1">
        <div className="w-10 h-1 bg-slate-200 rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 sm:py-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <History className="w-4 h-4 text-indigo-600" />
          <h3 className="font-semibold text-sm text-slate-800">Version History & Time-Travel</h3>
        </div>
        <button
          onClick={() => {
            setIsScrubbing(false);
            setPreviewElements(null);
            setSelectedCkptId(null);
            setTimelineOpen(false);
          }}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 touch-manipulation"
          title="Close history"
        >
          <X className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Scrubbing Mode Active Alert */}
      {isScrubbing && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-800">
          <span>Previewing historical state (Read-Only)</span>
          <button
            onClick={() => {
              setIsScrubbing(false);
              setPreviewElements(null);
              setSelectedCkptId(null);
            }}
            className="text-amber-900 font-semibold underline"
          >
            Exit Preview
          </button>
        </div>
      )}

      {/* Checkpoints List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-xs text-slate-400">Loading checkpoints...</div>
        ) : checkpoints.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <span>No checkpoints saved yet. Approving AI proposals automatically creates checkpoints.</span>
          </div>
        ) : (
          checkpoints.map((ckpt) => {
            const dateStr = new Date(ckpt.createdAt).toLocaleString();
            const isSelected = selectedCkptId === ckpt.id;

            return (
              <div
                key={ckpt.id}
                className={`p-3 rounded-lg border text-xs transition-colors ${
                  isSelected ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-500" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-800 truncate">{ckpt.label}</span>
                  <span className="text-[10px] text-slate-400">{dateStr}</span>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60">
                  <span className="text-[10px] text-slate-500 capitalize">Trigger: {ckpt.trigger}</span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => handlePreviewCheckpoint(ckpt.id)}
                      className="flex items-center space-x-1 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-indigo-600 bg-white border border-slate-300 rounded shadow-xs"
                    >
                      {isSelected ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{isSelected ? "Unpreview" : "Preview"}</span>
                    </button>

                    <button
                      onClick={() => handleRestoreCheckpoint(ckpt.id)}
                      className="flex items-center space-x-1 px-2 py-0.5 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-xs"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
