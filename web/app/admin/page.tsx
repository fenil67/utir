"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

// ── types ─────────────────────────────────────────────────────────────────────

interface PipelineRun {
  run_at:        string;
  step:          string;
  status:        string;
  new_servers:   number;
  classified:    number;
  confirmed:     number;
  scanned:       number;
  errors:        number;
  duration_secs: number;
}

interface MonitorEvent {
  id:                string;
  server_id:         string;
  server_name:       string;
  server_github_url: string;
  change_type:       string;
  severity:          string;
  detail:            string | null;
  detected_at:       string;
  rescan_triggered:  boolean;
  rescan_score:      number | null;
  acknowledged:      boolean;
}

interface Stats {
  total_servers: string;
  total_scanned: string;
  avg_score:     string;
  high_trust:    string;
  low_trust:     string;
  tier_f:        string;
}

interface AnalyticsOverview {
  views_today:           string;
  views_week:            string;
  installs_today:        string;
  installs_week:         string;
  searches_today:        number;
  top_pages:             { path: string; count: string }[];
  top_servers:           { name: string; github_url: string; count: string }[];
  referrers:             { referrer: string; count: string }[];
  top_installed_servers: { name: string; github_url: string; count: string }[];
}

interface SearchEntry {
  query:       string;
  results:     number | null;
  searched_at: string;
}

interface DashboardData {
  events:    MonitorEvent[];
  runs:      PipelineRun[];
  stats:     Stats | null;
  analytics: AnalyticsOverview | null;
  searches:  SearchEntry[];
}

// ── small helpers ─────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border border-red-500/30",
    high:     "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    medium:   "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    low:      "bg-white/[0.06] text-gray-400 border border-white/10",
  };
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded uppercase ${colors[severity] ?? colors.low}`}>
      {severity}
    </span>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const OWNER_ID = process.env.NEXT_PUBLIC_OWNER_CLERK_ID;
  const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

  if (!isLoaded) return <div className="p-8 text-gray-500 text-sm">Loading…</div>;

  if (!user) return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p className="text-gray-400 text-sm">Please sign in to access this page.</p>
    </div>
  );

  if (user.id !== OWNER_ID) return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p className="text-gray-400 text-sm">Access denied.</p>
    </div>
  );

  return <AdminDashboard adminKey={ADMIN_KEY} />;
}

// ── dashboard ─────────────────────────────────────────────────────────────────

function AdminDashboard({ adminKey }: { adminKey: string }) {
  const API_BASE  = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const [data,       setData]       = useState<DashboardData | null>(null);
  const [sevFilter,  setSevFilter]  = useState("");
  const [action,     setAction]     = useState<string | null>(null);
  const [tick,       setTick]       = useState(0);
  const [eventsPage, setEventsPage] = useState(0);

  const EVENTS_PER_PAGE = 10;


  // CRITICAL: only fetch when authed === true
  useEffect(() => {
    const headers = { "X-Admin-Key": adminKey };
    const eventsUrl = `${API_BASE}/api/admin/monitor/events${sevFilter ? `?severity=${sevFilter}` : ""}`;

    Promise.all([
      fetch(eventsUrl,                                          { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${API_BASE}/api/admin/pipeline-runs`,             { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${API_BASE}/api/stats`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/admin/analytics/overview`,        { headers }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/admin/analytics/searches`,        { headers }).then(r => r.json()).catch(() => null),
    ]).then(([events, runs, stats, analytics, searches]) => {
      setData({
        events:    events?.data    ?? [],
        runs:      runs?.data      ?? [],
        stats:     stats?.data     ?? null,
        analytics: analytics?.data ?? null,
        searches:  searches?.data  ?? [],
      });
    });
  }, [sevFilter, tick, adminKey, API_BASE]);

  // ── post actions ──────────────────────────────────────────────────────────
  async function runAction(label: string, path: string) {
    setAction(label);
    try {
      await fetch(`${API_BASE}${path}`, {
        method:  "POST",
        headers: { "X-Admin-Key": adminKey },
      });
      setTimeout(() => setAction(null), 3000);
    } catch {
      setAction(null);
    }
  }

  async function acknowledge(eventId: string) {
    await fetch(`${API_BASE}/api/admin/monitor/events/${eventId}/acknowledge`, {
      method:  "POST",
      headers: { "X-Admin-Key": adminKey },
    });
    setData(prev => prev && ({
      ...prev,
      events: prev.events.map(e => e.id === eventId ? { ...e, acknowledged: true } : e),
    }));
  }

  const flaggedServers = data.events.filter(
    e => !e.acknowledged && ["critical", "high"].includes(e.severity)
  ).length;



  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        <button
          onClick={() => { setData(null); setTick(t => t + 1); }}
          className="text-xs text-gray-500 hover:text-white transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Stats ── */}
      {data.stats && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ecosystem</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total servers",  value: data.stats.total_servers },
              { label: "Scanned",        value: data.stats.total_scanned },
              { label: "Avg score",      value: data.stats.avg_score ? `${data.stats.avg_score}/100` : "—" },
              { label: "Alerts pending", value: String(flaggedServers), highlight: flaggedServers > 0 },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                <p className="text-xs text-gray-600 mb-1">{label}</p>
                <p className={`text-2xl font-bold tabular-nums ${highlight ? "text-red-400" : "text-white"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Quick actions ── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick actions</h2>
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Run pipeline", path: "/api/admin/run-pipeline" },
            { label: "Run monitor",  path: "/api/admin/run-monitor"  },
          ].map(({ label, path }) => (
            <button
              key={label}
              onClick={() => runAction(label, path)}
              disabled={action !== null}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-white/[0.06] hover:bg-white/10 text-white border border-white/10 transition-colors disabled:opacity-50"
            >
              {action === label ? "Started ✓" : label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-2">Processes run in background — check logs for progress.</p>
      </section>

      {/* ── Monitor events ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Monitor events</h2>
          <select
            value={sevFilter}
            onChange={e => { setSevFilter(e.target.value); setEventsPage(0); }}
            className="text-xs bg-white/[0.05] border border-white/10 text-gray-400 rounded px-2 py-1 focus:outline-none"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {(() => {
          const totalEvents   = data.events.length;
          const visibleEvents = data.events.slice(
            eventsPage * EVENTS_PER_PAGE,
            (eventsPage + 1) * EVENTS_PER_PAGE,
          );
          const totalPages = Math.ceil(totalEvents / EVENTS_PER_PAGE);

          return (
            <>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                {totalEvents === 0 ? (
                  <p className="text-xs text-gray-600 p-6 text-center">
                    No events{sevFilter ? ` with severity "${sevFilter}"` : ""}.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-gray-600">
                        {["Server", "Change", "Severity", "Detected", "Rescan", "Score", ""].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEvents.map(ev => (
                        <tr
                          key={ev.id}
                          className={`border-b border-white/[0.04] last:border-0 ${ev.acknowledged ? "opacity-40" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <a href={ev.server_github_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                              {ev.server_name?.split("/").pop() ?? ev.server_name}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-gray-400 max-w-xs">
                            <span className="font-mono text-gray-500">{ev.change_type}</span>
                            {ev.detail && <p className="text-gray-600 truncate" title={ev.detail}>{ev.detail}</p>}
                          </td>
                          <td className="px-4 py-3"><SeverityBadge severity={ev.severity} /></td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {new Date(ev.detected_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-center"><StatusDot ok={ev.rescan_triggered} /></td>
                          <td className="px-4 py-3 text-gray-400 tabular-nums">{ev.rescan_score ?? "—"}</td>
                          <td className="px-4 py-3">
                            {!ev.acknowledged && (
                              <button
                                onClick={() => acknowledge(ev.id)}
                                className="text-xs text-gray-500 hover:text-white transition-colors whitespace-nowrap"
                              >
                                Acknowledge
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                  <button
                    disabled={eventsPage === 0}
                    onClick={() => setEventsPage(p => p - 1)}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Previous
                  </button>
                  <span>Page {eventsPage + 1} of {totalPages}</span>
                  <button
                    disabled={(eventsPage + 1) * EVENTS_PER_PAGE >= totalEvents}
                    onClick={() => setEventsPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </section>

      {/* ── Pipeline runs ── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Pipeline runs (last 10)</h2>
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {data.runs.length === 0 ? (
            <p className="text-xs text-gray-600 p-6 text-center">No pipeline runs recorded yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-gray-600">
                  {["Date", "Step", "Status", "New", "Classified", "Scanned", "Errors", "Duration"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(r.run_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono">{r.step}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${r.status === "ok" ? "text-emerald-400" : "text-red-400"}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{r.new_servers}</td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{r.classified}</td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{r.scanned}</td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={r.errors > 0 ? "text-red-400" : "text-gray-600"}>{r.errors}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{r.duration_secs}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Site analytics ── */}
      {data.analytics && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Site analytics</h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {[
              { label: "Views today",       value: data.analytics?.views_today    ?? "0" },
              { label: "Views (7 days)",    value: data.analytics?.views_week     ?? "0" },
              { label: "Searches today",    value: String(data.analytics?.searches_today ?? 0) },
              { label: "Installs today",    value: data.analytics?.installs_today ?? "0" },
              { label: "Installs (7 days)", value: data.analytics?.installs_week  ?? "0" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                <p className="text-xs text-gray-600 mb-1">{label}</p>
                <p className="text-2xl font-bold tabular-nums text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <p className="text-xs font-medium text-gray-500 px-4 py-2 border-b border-white/[0.06]">Top pages (7d)</p>
              {(data.analytics?.top_pages?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-600 p-4 text-center">No data yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {(data.analytics?.top_pages ?? []).map(row => (
                      <tr key={row.path} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-4 py-2 text-gray-400 font-mono truncate max-w-xs">{row.path}</td>
                        <td className="px-4 py-2 text-gray-500 tabular-nums text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-xl border border-white/10 overflow-hidden">
              <p className="text-xs font-medium text-gray-500 px-4 py-2 border-b border-white/[0.06]">Top server pages (7d)</p>
              {(data.analytics?.top_servers?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-600 p-4 text-center">No data yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {(data.analytics?.top_servers ?? []).map(row => (
                      <tr key={row.github_url} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-4 py-2">
                          <a href={row.github_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline truncate block max-w-xs">
                            {row.name?.split("/").pop() ?? row.name}
                          </a>
                        </td>
                        <td className="px-4 py-2 text-gray-500 tabular-nums text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {(data.analytics?.top_installed_servers?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
              <p className="text-xs font-medium text-gray-500 px-4 py-2 border-b border-white/[0.06]">Top installed servers (7d)</p>
              <table className="w-full text-xs">
                <tbody>
                  {(data.analytics?.top_installed_servers ?? []).map(row => (
                    <tr key={row.github_url} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-2">
                        <a href={row.github_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline truncate block max-w-xs">
                          {row.name?.split("/").pop() ?? row.name}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-gray-500 tabular-nums text-right">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.analytics?.referrers?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
              <p className="text-xs font-medium text-gray-500 px-4 py-2 border-b border-white/[0.06]">Top referrers (7d)</p>
              <table className="w-full text-xs">
                <tbody>
                  {(data.analytics?.referrers ?? []).map(row => (
                    <tr key={row.referrer} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-2 text-gray-400 truncate max-w-md font-mono">{row.referrer}</td>
                      <td className="px-4 py-2 text-gray-500 tabular-nums text-right">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.searches.length > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <p className="text-xs font-medium text-gray-500 px-4 py-2 border-b border-white/[0.06]">Recent searches</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-gray-600">
                    {["Query", "Results", "Time"].map(h => (
                      <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.searches.slice(0, 20).map((s, i) => (
                    <tr key={i} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-2 text-gray-300">{s.query}</td>
                      <td className="px-4 py-2 text-gray-500 tabular-nums">{s.results ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                        {new Date(s.searched_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
