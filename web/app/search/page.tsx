"use client";

import { useState, useEffect, useRef } from "react";
import ServerCard from "@/components/ServerCard";
import type { Server } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function SearchPage() {
  const [q,       setQ]       = useState("");
  const [results, setResults] = useState<Server[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(data.data ?? []);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-white mb-6">Search</h1>

      <div className="relative mb-8">
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
          placeholder="Search by name, description, or tool…"
          className="w-full pl-10 pr-4 py-3 text-sm bg-white/[0.05] border border-white/15 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-colors"
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((s) => (
            <ServerCard key={s.id} server={s} variant="card" />
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-12">
          No results for &ldquo;{q}&rdquo;
        </p>
      )}

      {!q && (
        <p className="text-gray-600 text-sm text-center py-12">
          Start typing to search across server names, descriptions, and tool names.
        </p>
      )}
    </div>
  );
}
