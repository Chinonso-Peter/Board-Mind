import React from "react";
import { Check, X, Sparkles } from "lucide-react";
import type { ActiveGhostProposal } from "../hooks/useBoardSync";

interface GhostPillProps {
  proposal: ActiveGhostProposal;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}

export const GhostPill: React.FC<GhostPillProps> = ({ proposal, onApprove, onDismiss }) => {
  const confidencePercent = Math.round(proposal.confidence * 100);

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto max-w-xl w-[92vw] sm:w-auto">
      <div className="flex items-center justify-between p-2.5 sm:p-3 bg-white/95 backdrop-blur border-2 border-indigo-600 rounded-2xl shadow-2xl text-slate-800 text-xs animate-in slide-in-from-top duration-300">
        <div className="flex items-center space-x-2.5 min-w-0 pr-3">
          <div className="flex items-center space-x-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold rounded-full shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>{confidencePercent}%</span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-600">
              AI Decision Proposed (Ghost Overlay)
            </div>
            <div className="font-semibold text-slate-800 text-xs sm:text-sm truncate max-w-xs sm:max-w-md" title={proposal.decisionSummary}>
              {proposal.decisionSummary}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          <button
            onClick={() => onApprove(proposal.id)}
            className="flex items-center space-x-1 px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-md transition-all touch-manipulation text-xs"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Approve</span>
          </button>
          <button
            onClick={() => onDismiss(proposal.id)}
            title="Dismiss proposal"
            className="p-1.5 hover:bg-slate-100 active:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-xl transition-colors touch-manipulation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
