import { useState, useRef, useEffect, useCallback } from "react";
import { useUIStore } from "../stores/uiStore";

export function useVoiceStream(
  boardId: string,
  wsToken?: string,
  onSpeechTranscript?: (text: string) => void
) {
  const [isSupported, setIsSupported] = useState(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const segmentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingActiveRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  const { isRecording, setIsRecording, setAudioLevel } = useUIStore();

  useEffect(() => {
    if (typeof window !== "undefined" && (!navigator.mediaDevices || !window.MediaRecorder)) {
      setIsSupported(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    isRecordingActiveRef.current = false;

    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // Safe cleanup
      }
      speechRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (activeStreamRef.current) {
      try {
        activeStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      activeStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsRecording(false);
    setAudioLevel(0);
  }, [setIsRecording, setAudioLevel]);

  const startRecording = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(
        "Microphone access is restricted on mobile browsers over plain HTTP.\n\n" +
        "To discuss architecture with AI on your phone:\n" +
        "1. Type directly into the chat input below (works 100% on mobile!)\n" +
        "2. Or on Android Chrome, enable chrome://flags/#unsafely-treat-insecure-origin-as-secure for http://" + window.location.host + "\n" +
        "3. Or use your PC browser at http://localhost:3000 where microphone is unrestricted."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      activeStreamRef.current = stream;
      isRecordingActiveRef.current = true;

      // 1. Native Web Speech Recognition for instant client transcription
      const SpeechRecognition =
        typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.lang = "en-US";
          recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript?.trim();
                if (text && onSpeechTranscript) {
                  onSpeechTranscript(text);
                }
              }
            }
          };
          recognition.onerror = () => {
            // Non-fatal, server Whisper is still active
          };
          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch {
          // Browser speech recognition not allowed or unavailable
        }
      }

      // 2. Connect to voice WebSocket for backend Whisper ingestion
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host =
        window.location.port === "3000"
          ? `${window.location.hostname}:4000`
          : (process.env.NEXT_PUBLIC_WS_HOST || `${window.location.hostname}:4000`);
      const wsUrl = `${proto}//${host}/ws/voice/${boardId}?token=${wsToken || ""}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "VOICE_CONFIG", mimeType }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "VOICE_ERROR") {
            console.warn("[VoiceStream] Server:", msg.message);
          }
        } catch {}
      };

      // 3. Segmented recorder: each audio slice is a self-contained, valid container with EBML headers
      const recordSegment = () => {
        if (!isRecordingActiveRef.current || !activeStreamRef.current) return;

        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(activeStreamRef.current, { mimeType });
        } catch {
          recorder = new MediaRecorder(activeStreamRef.current);
        }
        mediaRecorderRef.current = recorder;

        const chunks: Blob[] = [];

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          if (chunks.length > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const blob = new Blob(chunks, { type: mimeType });
            // Ignore sub-second noise / empty clicks (< 2KB)
            if (blob.size >= 2048) {
              blob.arrayBuffer().then((buffer) => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(buffer);
                }
              });
            }
          }

          // Continue streaming next segment if user is still in recording mode
          if (isRecordingActiveRef.current) {
            recordSegment();
          }
        };

        recorder.start();

        // Cycle segment every 5 seconds so each slice has full WebM headers for Whisper
        segmentTimeoutRef.current = setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, 5000);
      };

      recordSegment();

      // Web Audio API for audio level meter
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateMeter = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          const normalized = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(normalized);
          animFrameRef.current = requestAnimationFrame(updateMeter);
        };
        updateMeter();
      } catch {}

      setIsRecording(true);
    } catch (err: any) {
      console.warn("[VoiceStream] Microphone access denied or error:", err.message);
      stopRecording();
    }
  }, [boardId, wsToken, onSpeechTranscript, setIsRecording, setAudioLevel, stopRecording]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    isSupported,
    isRecording,
    startRecording,
    stopRecording,
  };
}
