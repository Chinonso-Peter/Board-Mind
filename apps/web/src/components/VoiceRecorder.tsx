import React from "react";
import { Mic, MicOff } from "lucide-react";
import { useUIStore } from "../stores/uiStore";

interface VoiceRecorderProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  disabled?: boolean;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onToggleRecording,
  disabled,
}) => {
  const { audioLevel } = useUIStore();

  return (
    <div className="relative flex items-center">
      {/* Pulsing ring indicator */}
      {isRecording && (
        <span
          style={{
            transform: `scale(${1 + (audioLevel / 100) * 0.5})`,
            opacity: 0.3 + (audioLevel / 100) * 0.7,
          }}
          className="absolute inset-0 rounded-full bg-red-500 pointer-events-none transition-transform duration-75 ease-out"
        />
      )}

      <button
        onClick={onToggleRecording}
        disabled={disabled}
        title={
          disabled
            ? "Microphone disabled (requires HTTPS or secure context)"
            : isRecording
            ? "Stop listening"
            : "Start listening to architecture review discussion"
        }
        className={`relative z-10 flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-md transition-all ${
          disabled
            ? "bg-slate-200 text-slate-400 cursor-not-allowed"
            : isRecording
            ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
            : "bg-indigo-600 hover:bg-indigo-700 text-white"
        }`}
      >
        {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        <span>{isRecording ? "Listening..." : "Listen"}</span>
      </button>
    </div>
  );
};
