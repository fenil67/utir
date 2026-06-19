"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DashboardServer, ScorePoint, InstallPoint } from "./page";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const AUTH_TIER_INFO: Record<string, { label: string; color: string }> = {
  A: { label: "Tier A — OAuth 2.0", color: "text-emerald-400" },
  B: { label: "Tier B — OAuth / JWT", color: "text-blue-400" },
  C: { label: "Tier C — API Key", color: "text-yellow-400" },
  F: { label: "Tier F — No Auth", color: "text-red-400" },
};

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-500";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function ScoreRing({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center w-24 h-24">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={pct >= 80 ? "#10b981" : pct >= 60 ? "#eab308" : pct >= 40 ? "#f97316" : "#ef4444"}
          strokeWidth="7"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-2xl font-bold tabular-nums ${scoreColor(score)}`}>
        {score ?? "—"}
      </span>
    </div>
  );
}

function ScoreChart({ history }: { history: ScorePoint[] }) {
  if (history.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-gray-600">
        Not enough scan history yet
      </div>
    );
  }

  const data = history.map((p) => ({
    date: new Date(p.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: p.trust_score,
  }));

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#9ca3af" }}
          itemStyle={{ color: "#10b981" }}
        />
        <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function InstallChart({ events }: { events: InstallPoint[] }) {
  if (events.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-gray-600">
        No installs tracked yet
      </div>
    );
  }

  const data = events.map((e) => ({
    date: new Date(e.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    installs: e.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#9ca3af" }}
          itemStyle={{ color: "#6366f1" }}
        />
        <Bar dataKey="installs" fill="#6366f1" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PendingServerCard({ server }: { server: DashboardServer }) {
  const repoName = server.name?.split("/").pop() ?? server.github_url.split("/").pop() ?? "Server";

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 overflow-hidden">
      <div className="px-6 py-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-base font-semibold text-white truncate">{repoName}</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Scanning in progress
            </span>
          </div>
          <p className="text-xs text-gray-600 font-mono mt-1 truncate">{server.github_url}</p>
          <p className="text-sm text-gray-500 mt-3">
            Your server is being classified and scanned. Check back in a few hours.
          </p>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
        <p className="text-xs text-gray-700">
          Submitted {new Date(server.claimed_at).toLocaleDateString()}
        </p>
        <a
          href={server.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-white transition-colors"
        >
          GitHub →
        </a>
      </div>
    </div>
  );
}

function ServerCard({ server, userId }: { server: DashboardServer; userId: string }) {
  const repoName = server.name?.split("/").pop() ?? server.name;
  const tierInfo = server.auth_tier ? AUTH_TIER_INFO[server.auth_tier] : null;
  const highFindings = (server.findings ?? []).filter((f) => String(f.severity).toUpperCase() === "HIGH");

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-base font-semibold text-white truncate">{repoName}</h2>
            {server.language && (
              <span className="text-xs bg-white/[0.06] text-gray-400 px-2 py-0.5 rounded">
                {server.language}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">{server.owner}</p>
          {server.description && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{server.description}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <ScoreRing score={server.trust_score} />
          <Link
            href={`/servers/${server.id}`}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Public page →
          </Link>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.06]">
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-gray-600 mb-0.5">Auth</p>
          <p className={`text-xs font-semibold ${tierInfo?.color ?? "text-gray-500"}`}>
            {tierInfo?.label.split("—")[0].trim() ?? "—"}
          </p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-gray-600 mb-0.5">Installs (30d)</p>
          <p className="text-sm font-semibold text-white tabular-nums">{server.total_installs.toLocaleString()}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-gray-600 mb-0.5">High findings</p>
          <p className={`text-sm font-semibold tabular-nums ${highFindings.length > 0 ? "text-red-400" : "text-gray-400"}`}>
            {highFindings.length}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 mb-3 font-medium">Trust score history</p>
          <ScoreChart history={server.score_history} />
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 mb-3 font-medium">Installs (last 30 days)</p>
          <InstallChart events={server.install_events} />
        </div>
      </div>

      {/* Findings */}
      {(server.findings ?? []).length > 0 && (
        <div className="px-5 py-4 border-t border-white/[0.06]">
          <p className="text-xs text-gray-500 mb-3 font-medium">
            Security findings <span className="text-gray-700">({server.findings!.length})</span>
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {server.findings!.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`shrink-0 font-medium px-1.5 py-0.5 rounded uppercase ${
                  String(f.severity).toUpperCase() === "HIGH"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-yellow-500/15 text-yellow-400"
                }`}>
                  {String(f.severity || "?")}
                </span>
                <p className="text-gray-400 truncate">{String(f.issue || f.test_id || "")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
        <p className="text-xs text-gray-700">
          {server.last_scanned
            ? `Last scanned ${new Date(server.last_scanned).toLocaleDateString()}`
            : "Not yet scanned"}
        </p>
        <a
          href={server.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-white transition-colors"
        >
          GitHub →
        </a>
      </div>
    </div>
  );
}

// ── Claim panel ───────────────────────────────────────────────────────────────

function ClaimPanel({ userId }: { userId: string }) {
  const { user } = useUser();
  const [githubUrl, setGithubUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const githubAccount = user?.externalAccounts?.find((a: { provider: string; username?: string }) => a.provider === "github");
  const githubUsername = githubAccount?.username;

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!githubUrl.trim()) return;

    if (!githubUsername) {
      setStatus("error");
      setMessage("Connect your GitHub account first to verify ownership. Go to your profile settings to connect GitHub.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch(`${API_BASE}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_url:      githubUrl.trim(),
          clerk_user_id:   userId,
          github_username: githubUsername,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage("Server claimed! Refresh to see your dashboard.");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Claim failed.");
      }
    } catch {
      setStatus("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
      <h3 className="text-sm font-semibold text-white mb-1">Claim a server</h3>

      {!githubUsername ? (
        <div className="mt-3 flex items-start gap-2.5 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <svg className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-xs text-yellow-300">
            Connect your GitHub account in{" "}
            <Link href="/user-profile" className="underline underline-offset-2 hover:text-yellow-200">
              profile settings
            </Link>{" "}
            to claim servers.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-4 mt-1">
            Enter your server&apos;s GitHub URL. We&apos;ll verify you own it by checking your connected GitHub account
            {" "}(<span className="text-gray-400">@{githubUsername}</span>).
          </p>

          {status === "success" ? (
            <p className="text-sm text-emerald-400">{message}</p>
          ) : (
            <form onSubmit={handleClaim} className="flex gap-2">
              <input
                type="url"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/yourusername/your-mcp-server"
                className="flex-1 text-xs px-3 py-2 bg-white/[0.05] border border-white/15 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                disabled={status === "loading"}
              />
              <button
                type="submit"
                disabled={status === "loading" || !githubUrl.trim()}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
              >
                {status === "loading" ? "…" : "Claim"}
              </button>
            </form>
          )}
          {status === "error" && (
            <p className="mt-2 text-xs text-red-400">{message}</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function DashboardClient({
  servers,
  userId,
}: {
  servers: DashboardServer[];
  userId: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">
          {servers.length === 1 ? "1 server" : `${servers.length} servers`}
        </h1>
        <Link
          href="/submit"
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          + Submit another
        </Link>
      </div>

      {servers.map((s) =>
        s.confirmed
          ? <ServerCard key={s.id} server={s} userId={userId} />
          : <PendingServerCard key={s.id} server={s} />
      )}

      <ClaimPanel userId={userId} />
    </div>
  );
}
