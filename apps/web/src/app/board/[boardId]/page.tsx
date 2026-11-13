"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Canvas } from "@/components/Canvas";

export default function BoardRoomPage() {
  const params = useParams();
  const boardId = params?.boardId as string;
  const { data: session } = useSession();

  const [board, setBoard] = useState<{ id: string; name: string } | null>(null);
  const [wsToken, setWsToken] = useState<string | undefined>(undefined);
  const currentUser = useMemo(() => ({
    id: (session?.user as any)?.id || session?.user?.email || `usr_${Math.random().toString(36).slice(2, 8)}`,
    name: session?.user?.name || session?.user?.email?.split("@")[0] || "Staff Architect",
  }), [session]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!boardId) return;

    const loadBoard = async () => {
      try {
        setLoading(true);
        // 1. Fetch board info
        const boardRes = await fetch(`/api/boards/${boardId}`);
        if (boardRes.ok) {
          const data = await boardRes.json();
          setBoard(data.board);
        } else {
          // If board doesn't exist yet, create default entry
          setBoard({ id: boardId, name: `Board ${boardId.slice(0, 8)}` });
        }

        // 2. Fetch ws-token
        const tokenRes = await fetch(`/api/boards/${boardId}/ws-token?userId=${currentUser.id}&role=owner`);
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          setWsToken(tokenData.token);
        }
      } catch (err: any) {
        console.warn("Error loading board:", err.message);
        setBoard({ id: boardId, name: "Architecture Board" });
      } finally {
        setLoading(false);
      }
    };

    loadBoard();
  }, [boardId, currentUser.id]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-500 text-sm">
        <div className="flex flex-col items-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
          <span>Connecting to BoardMind Room...</span>
        </div>
      </div>
    );
  }

  return (
    <Canvas
      boardId={boardId}
      boardName={board?.name || "System Architecture Board"}
      wsToken={wsToken}
      currentUser={currentUser}
    />
  );
}
