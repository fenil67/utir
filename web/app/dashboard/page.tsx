"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DashboardClient from "./DashboardClient";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function fetchDashboardData(userId: string) {
  const res = await fetch(`${API_BASE}/api/dashboard/${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data as { servers: DashboardServer[] };
}

export interface ScorePoint {
  scanned_at: string;
  trust_score: number;
}

export interface InstallPoint {
  day: string;
  count: number;
}

export interface Finding {
  severity?: string;
  issue?: string;
  test_id?: string;
  filename?: string;
  line?: number;
}

export interface DashboardServer {
  id: string;
  name: string;
  github_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  owner: string | null;
  last_pushed: string | null;
  claimed_at: string;
  confirmed: boolean;
  trust_score: number | null;
  auth_tier: string | null;
  static_score: number | null;
  deps_score: number | null;
  maintenance_score: number | null;
  findings: Finding[] | null;
  last_scanned: string | null;
  score_history: ScorePoint[];
  install_events: InstallPoint[];
  total_installs: number;
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const data = await fetchDashboardData(userId);
  const servers = data?.servers ?? [];

  return (
    <div>
      {servers.length === 0 ? (
        <EmptyState />
      ) : (
        <DashboardClient servers={servers} userId={userId} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 mb-4">
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">No servers claimed yet</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        Submit your MCP server to the registry, then claim it here to see your trust score and analytics.
      </p>
      <Link
        href="/submit"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors"
      >
        Submit a server
      </Link>
    </div>
  );
}
