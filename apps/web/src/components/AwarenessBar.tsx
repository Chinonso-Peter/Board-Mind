import React from "react";
import { Sparkles, Mic } from "lucide-react";

interface Collaborator {
  id: string;
  name: string;
  speaking?: boolean;
}

interface AwarenessBarProps {
  collaborators: Collaborator[];
  aiStatus: string | null;
}

export const AwarenessBar: React.FC<AwarenessBarProps> = ({ collaborators, aiStatus }) => {
  return (
    <div className="flex items-center space-x-2">
      {aiStatus && (
        <div className="flex items-center space-x-1.5 px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium rounded-full animate-pulse shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
          <span>AI is {aiStatus}...</span>
        </div>
      )}

      <div className="flex items-center -space-x-1.5 overflow-hidden">
        {collaborators.map((user) => {
          const initials = user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={user.id}
              title={`${user.name}${user.speaking ? " (Speaking)" : ""}`}
              className={`relative inline-flex items-center justify-center w-7 h-7 text-xs font-semibold text-white rounded-full border-2 border-white bg-slate-700 shadow-sm transition-transform hover:scale-110 ${
                user.speaking ? "ring-2 ring-emerald-500 animate-pulse" : ""
              }`}
            >
              <span>{initials}</span>
              {user.speaking && (
                <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full flex items-center justify-center">
                  <Mic className="w-2 h-2 text-white" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
