"use client";

import { useState } from "react";
import { ServerDetail } from "@/lib/api";
import InstallCopyButton from "@/components/InstallCopyButton";

// ── helpers ───────────────────────────────────────────────────────────────────

const AUTH_TIER_INFO: Record<string, { label: string; description: string; color: string }> = {
  A: { label: "Tier A — OAuth 2.0 / OIDC", description: "Full OAuth 2.0 with authorization code flow, PKCE, or OIDC. Best-in-class authentication.", color: "text-emerald-400" },
  B: { label: "Tier B — OAuth / JWT", description: "OAuth with access tokens or JWT verification. Good authentication.", color: "text-blue-400" },
  C: { label: "Tier C — API Key", description: "Static API key or bearer token. Basic authentication — key may be long-lived.", color: "text-yellow-400" },
  F: { label: "Tier F — No Auth", description: "No authentication mechanism detected. Use with extreme caution.", color: "text-red-400" },
};

function getParamNames(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as Record<string, unknown>;
  if (s.properties && typeof s.properties === "object") {
    return Object.keys(s.properties as object);
  }
  return [];
}

// ── ScoreBar ──────────────────────────────────────────────────────────────────

function ScoreBar({
  label,
  score,
  max,
  note,
}: {
  label: string;
  score: number | null;
  max: number;
  note?: string;
}) {
  const pct = score !== null ? Math.round((score / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400 flex items-center gap-1">
          {label}
          {note && (
            <span className="text-gray-600 text-xs cursor-help" title={note}>
              ⓘ
            </span>
          )}
        </span>
        <span className="text-white font-mono tabular-nums">
          {score ?? "—"}
          <span className="text-gray-600">/{max}</span>
        </span>
      </div>
      {note && score === 0 && (
        <p className="text-xs text-gray-600 mb-1 italic">{note}</p>
      )}
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

type Tab = "overview" | "tools";

interface Props {
  server: ServerDetail;
  installSnippet: string;
}

export default function ServerDetailTabs({ server, installSnippet }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const tierInfo = server.auth_tier ? AUTH_TIER_INFO[server.auth_tier] : null;
  const tools = server?.tools || [];

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tools", label: tools.length > 0 ? `Tools (${tools.length})` : "Tools" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/10 mb-6">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              tab === id ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
            {tab === id && (
              <span className="absolute bottom-0 inset-x-0 h-0.5 bg-emerald-500 rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Score breakdown */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Score Breakdown</h2>
              <div className="space-y-4">
                <ScoreBar
                  label="Authentication"
                  score={
                    server.auth_tier
                      ? ({ A: 30, B: 25, C: 15, F: 0 } as Record<string, number>)[server.auth_tier] ?? null
                      : null
                  }
                  max={30}
                />
                <ScoreBar label="Static Analysis" score={server.static_score} max={25} />
                <ScoreBar label="Dependencies" score={server.deps_score} max={20} />
                <ScoreBar
                  label="Behavior"
                  score={server.behavior_score ?? 0}
                  max={15}
                  note="Sandbox testing not available in cloud environment"
                />
                <ScoreBar label="Maintenance" score={server.maintenance_score} max={10} />
              </div>
            </div>

            {/* Auth tier */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Authentication</h2>
              {tierInfo ? (
                <>
                  <p className={`text-lg font-semibold mb-2 ${tierInfo.color}`}>{tierInfo.label}</p>
                  <p className="text-sm text-gray-400">{tierInfo.description}</p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Not yet scanned</p>
              )}
              {server.last_scanned && (
                <p className="text-xs text-gray-600 mt-4">
                  Last scanned {new Date(server.last_scanned).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {/* Security findings */}
          {Array.isArray(server.findings) && server.findings.length > 0 && (
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">
                Security Findings
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ({server.findings.length})
                </span>
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(server.findings as Array<Record<string, unknown>>).map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 text-sm py-2 border-b border-white/[0.05] last:border-0"
                  >
                    <span
                      className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded uppercase tabular-nums ${
                        String(f.severity).toUpperCase() === "HIGH"
                          ? "bg-red-500/15 text-red-400"
                          : "bg-yellow-500/15 text-yellow-400"
                      }`}
                    >
                      {String(f.severity || "?")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-300 truncate">{String(f.issue || f.test_id || "")}</p>
                      {f.filename != null && (
                        <p className="text-xs text-gray-600 truncate font-mono">
                          {String(f.filename)}
                          {f.line != null ? `:${String(f.line)}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Install snippet */}
          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Claude Desktop Config</h2>
              <InstallCopyButton snippet={installSnippet} serverId={server.id} />
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Add this to your{" "}
              <code className="font-mono text-gray-400">claude_desktop_config.json</code>:
            </p>
            <pre className="text-xs font-mono text-gray-300 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
              {installSnippet}
            </pre>
            <p className="text-xs text-gray-600 mt-2">
              Refer to the{" "}
              <a
                href={server.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline"
              >
                repo README
              </a>{" "}
              for exact installation instructions.
            </p>
          </div>
        </div>
      )}

      {/* ── Tools ────────────────────────────────────────────────────────────── */}
      {tab === "tools" && (
        <div>
          {tools.length === 0 ? (
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-10 text-center">
              <p className="text-gray-400 mb-1">No tools detected.</p>
              <p className="text-sm text-gray-600">
                Tools are extracted automatically from source code during scanning.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-xl bg-white/[0.03] border border-white/10 p-4"
                >
                  <p className="font-mono text-emerald-400 text-sm font-medium mb-1">
                    {tool.name}
                  </p>
                  <p className="text-sm text-gray-400">
                    {tool.description || "No description"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}