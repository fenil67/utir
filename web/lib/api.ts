const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface Server {
  id: string;
  name: string;
  github_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  owner: string;
  topics: string[];
  last_pushed: string | null;
  created_at: string;
  trust_score: number | null;
  auth_tier: string | null;
  static_score: number | null;
  deps_score: number | null;
  maintenance_score: number | null;
  findings_count: number | null;
  last_scanned: string | null;
}

export interface MonitorEvent {
  id:               string;
  change_type:      string;
  severity:         string;
  detail:           string | null;
  detected_at:      string;
  rescan_triggered: boolean;
  rescan_score:     number | null;
  acknowledged:     boolean;
}

export interface ServerDetail extends Server {
  description:          string | null;
  behavior_score:       number | null;
  findings:             unknown[];
  raw_output:           unknown;
  tools:                Tool[];
  monitor_flag:         string | null;
  last_monitored:       string | null;
  latest_monitor_event: MonitorEvent | null;
}

export interface Tool {
  id: string;
  name: string;
  description: string | null;
  input_schema: unknown;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface Stats {
  total_servers: string;
  total_scanned: string;
  avg_score: string | null;
  high_trust: string;
  low_trust: string;
  tier_f: string;
  tier_a: string;
  tier_b: string;
  tier_c: string;
  languages: { language: string; count: string }[];
  score_distribution: { range: string; count: string }[];
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function getServers(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();
  return apiFetch<{ data: Server[]; pagination: Pagination }>(
    `/api/servers${query ? `?${query}` : ""}`
  );
}

export async function getServer(id: string) {
  return apiFetch<{ data: ServerDetail }>(`/api/servers/${id}`);
}

export async function searchServers(q: string) {
  return apiFetch<{ data: Server[]; query: string }>(
    `/api/search?q=${encodeURIComponent(q)}`
  );
}

export async function getStats() {
  return apiFetch<{ data: Stats }>("/api/stats");
}

export async function getMonitorEvents(serverId: string) {
  return apiFetch<{ data: MonitorEvent[] }>(`/api/monitor/events/${serverId}`);
}
