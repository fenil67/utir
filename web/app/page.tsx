import Link from "next/link";
import { getServers, getStats } from "@/lib/api";
import ServerCard from "@/components/ServerCard";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
      <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-sm text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function HomePage() {
  const [serversRes, statsRes] = await Promise.allSettled([
    getServers({ limit: 10, sort: "score_desc" }),
    getStats(),
  ]);

  const servers = serversRes.status === "fulfilled" ? serversRes.value.data : [];
  const stats   = statsRes.status === "fulfilled"   ? statsRes.value.data   : null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-16">

      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Open registry · Updated nightly
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
          The trust registry for<br />
          <span className="text-emerald-400">MCP servers</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-xl mx-auto mb-8">
          661 servers scanned. 78% have significant security issues.
          Find the ones you can trust.
        </p>

        {/* Search bar — links to /search (interactive page) */}
        <Link
          href="/search"
          className="inline-flex items-center gap-3 w-full max-w-md mx-auto px-4 py-3 rounded-xl bg-white/[0.05] border border-white/15 text-gray-500 hover:border-white/25 hover:bg-white/[0.07] transition-all cursor-text"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm">Search servers, tools, descriptions…</span>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-14">
        <StatCard
          label="Total Scanned"
          value={stats ? Number(stats.total_scanned).toLocaleString() : "661"}
          sub={stats ? `${Number(stats.total_servers).toLocaleString()} total in registry` : undefined}
        />
        <StatCard
          label="High Trust (score ≥ 70)"
          value={stats ? Number(stats.high_trust).toLocaleString() : "12"}
          sub={stats?.avg_score ? `Avg score: ${stats.avg_score}` : undefined}
        />
        <StatCard
          label="Tier F — No Auth"
          value={stats ? Number(stats.tier_f).toLocaleString() : "85"}
          sub="No authentication found"
        />
      </div>

      {/* Top servers */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Top servers by trust score</h2>
          <Link href="/servers" className="text-sm text-gray-400 hover:text-white transition-colors">
            View all →
          </Link>
        </div>

        {servers.length > 0 ? (
          <div className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/[0.06]">
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} variant="row" />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 p-8 text-center text-gray-500">
            No servers available yet — run the crawler and scanner first.
          </div>
        )}
      </div>

      <div className="text-center">
        <Link
          href="/servers"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.06] border border-white/15 text-sm text-white hover:bg-white/[0.10] transition-colors"
        >
          View all servers
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
