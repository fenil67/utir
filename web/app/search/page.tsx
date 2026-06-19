"use client";

import { useState, useEffect, useRef } from "react";
import ServerCard from "@/components/ServerCard";
import type { Server } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface SearchResult extends Server {
  similarity: number | null;
}

function SimilarityBadge({ similarity }: { similarity: number | null }) {
  if (similarity === null) return null;
  const pct = Math.round(similarity * 100);
  const color =
    pct >= 90 ? "bg-emerald-500/15 text-emerald-400" :
    pct >= 75 ? "bg-yellow-500/15 text-yellow-400"   :
                "bg-white/[0.06] text-gray-500";
  return (
    <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded tabular-nums ${color}`}>
      {pct}% match
    </span>
  );
}

export default function SearchPage() {
  const [q,        setQ]        = useState("");
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);
  const [mode,     setMode]     = useState<"semantic" | "text" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); setSearched(false); setMode(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(data.data ?? []);
        setMode(data.mode ?? null);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  // Split at the 80% similarity boundary for the divider
  const highResults = results.filter((r) => r.similarity === null || r.similarity >= 0.80);
  const lowResults  = results.filter((r) => r.similarity !== null && r.similarity < 0.80);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-white mb-6">Search</h1>

      <div className="relative mb-2">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by what you need — 'send emails', 'browse web', 'read database'…"
          className="w-full pl-10 pr-4 py-3 text-sm bg-white/[0.05] border border-white/15 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-colors"
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        )}
      </div>

      {/* Semantic label */}
      <p className="text-xs text-gray-600 mb-8 pl-1">
        Semantic search — finds servers by capability, not just keywords
        {mode === "text" && (
          <span className="ml-1 text-gray-700">(text mode)</span>
        )}
      </p>

      {results.length > 0 && (
        <div className="space-y-3">
          {highResults.map((s) => (
            <div key={s.id} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <ServerCard server={s} variant="card" />
              </div>
              <div className="shrink-0 pt-3 pr-1">
                <SimilarityBadge similarity={s.similarity} />
              </div>
            </div>
          ))}

          {lowResults.length > 0 && (
            <>
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-gray-600 whitespace-nowrap">Less relevant results below</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              {lowResults.map((s) => (
                <div key={s.id} className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <ServerCard server={s} variant="card" />
                  </div>
                  <div className="shrink-0 pt-3 pr-1">
                    <SimilarityBadge similarity={s.similarity} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-12">
          No results for &ldquo;{q}&rdquo;
        </p>
      )}

      {!q && (
        <p className="text-gray-600 text-sm text-center py-12">
          Start typing to search across server capabilities.
        </p>
      )}
    </div>
  );
}
