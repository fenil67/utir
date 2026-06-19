"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Server, Pagination } from "@/lib/api";
import ServerCard from "./ServerCard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Props {
  initialServers: Server[];
  initialPagination: Pagination;
  initialParams: {
    q?: string;
    sort?: string;
    language?: string;
    auth_tier?: string;
    min_score?: string;
  };
}

const SORT_OPTIONS = [
  { value: "score_desc", label: "Highest Score" },
  { value: "score_asc",  label: "Lowest Score" },
  { value: "stars_desc", label: "Most Stars" },
  { value: "newest",     label: "Recently Added" },
];

const AUTH_TIERS = ["", "A", "B", "C", "F"];
const LANGUAGES  = ["", "Python", "TypeScript", "JavaScript", "Go", "Rust"];

export default function ServersClient({ initialServers, initialPagination, initialParams }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [servers, setServers]       = useState(initialServers);
  const [pagination, setPagination] = useState(initialPagination);
  const [loading, setLoading]       = useState(false);

  const [q,        setQ]        = useState(initialParams.q        ?? "");
  const [sort,     setSort]     = useState(initialParams.sort     ?? "score_desc");
  const [language, setLanguage] = useState(initialParams.language ?? "");
  const [authTier, setAuthTier] = useState(initialParams.auth_tier ?? "");
  const [minScore, setMinScore] = useState(initialParams.min_score ?? "");
  const [page,     setPage]     = useState(1);

  const fetchServers = useCallback(async (params: Record<string, string>, pageNum: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ ...params, page: String(pageNum), limit: "20" });
      const res = await fetch(`${API_BASE}/api/servers?${qs}`);
      const data = await res.json();
      setServers(data.data);
      setPagination(data.pagination);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync filters to URL and re-fetch
  useEffect(() => {
    const params: Record<string, string> = { sort };
    if (q)        params.q         = q;
    if (language) params.language  = language;
    if (authTier) params.auth_tier = authTier;
    if (minScore) params.min_score = minScore;

    // Update URL without navigation
    const qs = new URLSearchParams(params);
    router.replace(`${pathname}?${qs}`, { scroll: false });

    const timer = setTimeout(() => fetchServers(params, page), q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, language, authTier, minScore, page]);

  function resetFilters() {
    setQ(""); setSort("score_desc"); setLanguage("");
    setAuthTier(""); setMinScore(""); setPage(1);
  }

  const hasFilters = q || language || authTier || minScore || sort !== "score_desc";

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Filter by name or description…"
          className="flex-1 min-w-48 px-3 py-2 text-sm bg-white/[0.05] border border-white/15 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-colors"
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm bg-white/[0.05] border border-white/15 rounded-lg text-gray-300 focus:outline-none focus:border-white/30 transition-colors"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={language}
          onChange={(e) => { setLanguage(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm bg-white/[0.05] border border-white/15 rounded-lg text-gray-300 focus:outline-none focus:border-white/30 transition-colors"
        >
          {LANGUAGES.map((l) => <option key={l} value={l}>{l || "Any Language"}</option>)}
        </select>
        <select
          value={authTier}
          onChange={(e) => { setAuthTier(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm bg-white/[0.05] border border-white/15 rounded-lg text-gray-300 focus:outline-none focus:border-white/30 transition-colors"
        >
          {AUTH_TIERS.map((t) => <option key={t} value={t}>{t ? `Auth Tier ${t}` : "Any Auth Tier"}</option>)}
        </select>
        <select
          value={minScore}
          onChange={(e) => { setMinScore(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm bg-white/[0.05] border border-white/15 rounded-lg text-gray-300 focus:outline-none focus:border-white/30 transition-colors"
        >
          <option value="">Any Score</option>
          <option value="80">Score ≥ 80</option>
          <option value="60">Score ≥ 60</option>
          <option value="40">Score ≥ 40</option>
        </select>
        {hasFilters && (
          <button
            onClick={resetFilters}
            className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-4">
        {loading ? "Loading…" : `${pagination.total.toLocaleString()} server${pagination.total !== 1 ? "s" : ""}`}
      </p>

      {/* Grid */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
        {servers.length > 0
          ? servers.map((s) => <ServerCard key={s.id} server={s} variant="card" />)
          : !loading && (
            <div className="col-span-full py-16 text-center text-gray-500">
              No servers match your filters.
            </div>
          )
        }
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-4 py-2 text-sm rounded-lg border border-white/15 text-gray-400 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500 px-2">
            {page} / {pagination.total_pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
            disabled={page >= pagination.total_pages || loading}
            className="px-4 py-2 text-sm rounded-lg border border-white/15 text-gray-400 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
