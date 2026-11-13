"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, LayoutDashboard, Cpu, ArrowRight, ShieldCheck, RefreshCw, LogOut, User } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

interface BoardItem {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
  member_count: number;
}

interface ProviderStatus {
  name: string;
  model: string;
  circuit: string;
  requestsToday: number;
  maxRPD: number;
}

export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBoardName, setNewBoardName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [boardsRes, aiRes] = await Promise.all([
        fetch("/api/boards"),
        fetch("/api/ai/status"),
      ]);

      if (boardsRes.ok) {
        const data = await boardsRes.json();
        setBoards(data.boards || []);
      }
      if (aiRes.ok) {
        const data = await aiRes.json();
        setProviders(data.providers || []);
      }
    } catch (err: any) {
      console.warn("Error fetching dashboard data:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;

    try {
      setCreating(true);
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBoardName.trim() }),
      });

      if (res.ok) {
        setNewBoardName("");
        fetchData();
      }
    } catch (err: any) {
      alert(`Failed to create board: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-slate-50 text-slate-900 flex flex-col touch-scroll">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-20 shadow-2xs">
        <div className="flex items-center space-x-2.5 sm:space-x-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-xs sm:text-sm shadow-md">
            BM
          </div>
          <div>
            <span className="font-bold text-sm sm:text-base text-slate-800 tracking-tight">BoardMind</span>
            <span className="ml-1.5 sm:ml-2 text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200">
              v1.0.0
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          {session?.user ? (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="flex items-center space-x-2 bg-slate-100 hover:bg-slate-200/70 transition-colors py-1 px-2.5 rounded-full border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                  {(session.user.name || session.user.email || "U").charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">
                    {session.user.name || session.user.email?.split("@")[0] || "Architect"}
                  </span>
                  <span className="text-[10px] text-slate-500 leading-tight">
                    {session.user.email || "Signed In"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                title="Sign out"
                className="flex items-center space-x-1 text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors p-1.5 rounded-lg hover:bg-slate-100 touch-manipulation"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : authStatus === "loading" ? (
            <div className="w-24 h-7 bg-slate-100 rounded-lg animate-pulse" />
          ) : (
            <>
              <Link
                href="/login"
                className="text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors px-2 py-1"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="text-xs font-semibold px-2.5 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shadow-sm"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
        {/* Banner Section */}
        <section className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-xl sm:rounded-2xl p-5 sm:p-6 md:p-8 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-5 sm:gap-6">
          <div className="space-y-2 max-w-xl">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight">
              Real-Time AI Architecture Whiteboard
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              Passively listens to live engineering design reviews, detects architectural decisions,
              and proposes non-destructive diagram ghost overlays with full time-travel checkpoints.
            </p>
          </div>

          <form onSubmit={handleCreateBoard} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              placeholder="e.g. Payments Microservices"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-white/40"
            />
            <button
              type="submit"
              disabled={creating || !newBoardName.trim()}
              className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shadow-md touch-manipulation"
            >
              <Plus className="w-4 h-4" />
              <span>{creating ? "Creating..." : "New Board"}</span>
            </button>
          </form>
        </section>

        {/* AI Providers Failover Health Status */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2 text-slate-800">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-sm">Multi-Provider AI Failover Chain Status</h3>
            </div>
            <button
              onClick={fetchData}
              title="Refresh provider status"
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {providers.map((p, idx) => {
              const isClosed = p.circuit === "CLOSED";
              return (
                <div
                  key={p.name}
                  className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 capitalize">
                      [{idx + 1}] {p.name}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isClosed ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 truncate" title={p.model}>
                    {p.model}
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1">
                    Quota: {p.requestsToday} / {p.maxRPD} RPD
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Architecture Boards List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <LayoutDashboard className="w-4 h-4 text-slate-700" />
              <h3 className="font-bold text-base text-slate-800">Your Architecture Boards</h3>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs text-slate-400">Loading boards...</div>
          ) : boards.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400 space-y-2">
              <p className="text-sm font-semibold text-slate-600">No boards created yet</p>
              <p className="text-xs">Create your first board above to start diagramming.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {boards.map((b) => {
                const dateStr = new Date(b.updated_at).toLocaleDateString();
                return (
                  <Link
                    key={b.id}
                    href={`/board/${b.id}`}
                    className="group bg-white border border-slate-200 hover:border-indigo-400 rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-indigo-600 px-2 py-0.5 bg-indigo-50 rounded-md">
                          Board
                        </span>
                        <span className="text-[10px] text-slate-400">Updated {dateStr}</span>
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm group-hover:text-indigo-600 transition-colors">
                        {b.name}
                      </h4>
                    </div>

                    <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span>Collaborators: {b.member_count || 1}</span>
                      <span className="flex items-center space-x-1 text-indigo-600 font-semibold group-hover:translate-x-0.5 transition-transform">
                        <span>Open Canvas</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
