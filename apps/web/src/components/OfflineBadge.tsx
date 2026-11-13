import React from "react";
import { WifiOff } from "lucide-react";

interface OfflineBadgeProps {
  isOffline: boolean;
}

export const OfflineBadge: React.FC<OfflineBadgeProps> = ({ isOffline }) => {
  if (!isOffline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center space-x-2 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-lg">
      <WifiOff className="w-4 h-4 animate-bounce" />
      <span>Offline — Canvas edits saved locally</span>
    </div>
  );
};
