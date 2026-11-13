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
    <div
      style={{
        transform: `translate(${proposal.centroid.x}px, ${proposal.centroid.y}px)`,
      }}
      className="absolute top-0 left-0 z-40 pointer-events-auto transform -translate-x-1/2 -translate-y-full transition-all duration-200"
    >
      <div className="flex items-center space-x-2 px-3 py-1.5 bg-white/95 backdrop-blur border-2 border-indigo-500 rounded-full shadow-xl text-slate-800 text-xs">
        <div className="flex items-center space-x-1 text-indigo-600 font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{confidencePercent}%</span>
        </div>

        <span className="max-w-[220px] truncate text-slate-600 font-medium" title={proposal.decisionSummary}>
          {proposal.decisionSummary}
        </span>

        <div className="flex items-center space-x-1 border-l border-slate-200 pl-2">
          <button
            onClick={() => onApprove(proposal.id)}
            title="Approve architectural mutation"
            className="flex items-center space-x-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-full transition-colors shadow-sm"
          >
            <Check className="w-3 h-3 stroke-[3]" />
            <span>Approve</span>
          </button>

          <button
            onClick={() => onDismiss(proposal.id)}
            title="Dismiss proposal"
            className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
