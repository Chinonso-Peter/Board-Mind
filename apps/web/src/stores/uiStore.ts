import { create } from "zustand";
import type { ExcalidrawElement } from "@boardmind/ai-core";

export interface UIState {
  isOffline: boolean;
  setIsOffline: (offline: boolean) => void;

  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  audioLevel: number;
  setAudioLevel: (level: number) => void;

  transcriptOpen: boolean;
  setTranscriptOpen: (open: boolean) => void;

  timelineOpen: boolean;
  setTimelineOpen: (open: boolean) => void;

  isScrubbing: boolean;
  setIsScrubbing: (scrubbing: boolean) => void;
  previewElements: ExcalidrawElement[] | null;
  setPreviewElements: (elements: ExcalidrawElement[] | null) => void;

  activeProposalId: string | null;
  setActiveProposalId: (id: string | null) => void;

  aiNotice: { message: string; level: "info" | "warn" | "error" } | null;
  setAiNotice: (notice: { message: string; level: "info" | "warn" | "error" } | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isOffline: false,
  setIsOffline: (isOffline) => set({ isOffline }),

  isRecording: false,
  setIsRecording: (isRecording) => set({ isRecording }),
  audioLevel: 0,
  setAudioLevel: (audioLevel) => set({ audioLevel }),

  transcriptOpen: false,
  setTranscriptOpen: (transcriptOpen) => set({ transcriptOpen }),

  timelineOpen: false,
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),

  isScrubbing: false,
  setIsScrubbing: (isScrubbing) => set({ isScrubbing }),
  previewElements: null,
  setPreviewElements: (previewElements) => set({ previewElements }),

  activeProposalId: null,
  setActiveProposalId: (activeProposalId) => set({ activeProposalId }),

  aiNotice: null,
  setAiNotice: (aiNotice) => set({ aiNotice }),
}));
