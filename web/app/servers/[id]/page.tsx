import Link from "next/link";
import { notFound } from "next/navigation";
import { getServer } from "@/lib/api";
import TrustBadge from "@/components/TrustBadge";

interface Props {
  params: Promise<{ id: string }>;
}

function ScoreBar({ label, score, max }: { label: string; score: number | null; max: number }) {
  const pct = score !== null ? Math.round((score / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono tabular-nums">
          {score ?? "—"}<span className="text-gray-600">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const AUTH_TIER_INFO: Record<string, { label: string; description: string; color: string }> = {
  A: { label: "Tier A — OAuth 2.0 / OIDC", description: "Full OAuth 2.0 with authorization code flow, PKCE, or OIDC. Best-in-class authentication.", color: "text-emerald-400" },
  B: { label: "Tier B — OAuth / JWT", description: "OAuth with access tokens or JWT verification. Good authentication.", color: "text-blue-400" },
  C: { label: "Tier C — API Key", description: "Static API key or bearer token. Basic authentication — key may be long-lived.", color: "text-yellow-400" },
  F: { label: "Tier F — No Auth", description: "No authentication mechanism detected. Use with extreme caution.", color: "text-red-400" },
};

export default async function ServerDetailPage({ params }: Props) {
  const { id } = await params;

  let server;
  try {
    const res = await getServer(id);
    server = res.data;
  } catch {
    notFound();
  }

  if (!server) notFound();

  const repoName = server.name?.split("/").pop() ?? server.name;
  const tierInfo = server.auth_tier ? AUTH_TIER_INFO[server.auth_tier] : null;

  // Build a simple Claude Desktop config snippet
  const installSnippet = JSON.stringify(
    {
      mcpServers: {
        [repoName ?? "server"]: {
          command: server.language === "Python" ? "python" : "npx",
          args: server.language === "Python"
            ? ["-m", repoName ?? "server"]
            : ["-y", server.github_url],
        },
      },
    },
    null,
    2
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">

      {/* Back */}
      <Link href="/servers" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors mb-8">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        All servers
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 mb-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="text-2xl font-bold text-white">{repoName}</h1>
            {server.language && (
              <span className="text-xs bg-white/[0.06] text-gray-400 px-2 py-0.5 rounded">
                {server.language}
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mb-2">{server.owner}</p>
          {server.description && (
            <p className="text-gray-300">{server.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
            <span>★ {server.stars.toLocaleString()}</span>
            {server.last_pushed && (
              <span>Pushed {new Date(server.last_pushed).toLocaleDateString()}</span>
            )}
            <a
              href={server.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
            >
              View on GitHub
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
        <TrustBadge score={server.trust_score} size="lg" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Score breakdown */}
        <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Score Breakdown</h2>
          <div className="space-y-4">
            <ScoreBar label="Authentication"  score={server.auth_tier ? { A: 30, B: 25, C: 15, F: 0 }[server.auth_tier] ?? null : null} max={30} />
            <ScoreBar label="Static Analysis" score={server.static_score}       max={25} />
            <ScoreBar label="Dependencies"    score={server.deps_score}          max={20} />
            <ScoreBar label="Behavior"        score={server.behavior_score ?? 0} max={15} />
            <ScoreBar label="Maintenance"     score={server.maintenance_score}   max={10} />
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

      {/* Findings */}
      {Array.isArray(server.findings) && server.findings.length > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">
            Security Findings
            <span className="ml-2 text-xs font-normal text-gray-500">
              ({server.findings.length})
            </span>
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(server.findings as Array<Record<string, unknown>>).map((f, i) => (
              <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-white/[0.05] last:border-0">
                <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded uppercase tabular-nums ${
                  String(f.severity).toUpperCase() === "HIGH"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-yellow-500/15 text-yellow-400"
                }`}>
                  {String(f.severity || "?")}
                </span>
                <div className="min-w-0">
                  <p className="text-gray-300 truncate">{String(f.issue || f.test_id || "")}</p>
                  {f.filename != null && (
                    <p className="text-xs text-gray-600 truncate font-mono">
                      {String(f.filename)}{f.line != null ? `:${String(f.line)}` : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tools */}
      {server.tools && server.tools.length > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">
            Tools
            <span className="ml-2 text-xs font-normal text-gray-500">({server.tools.length})</span>
          </h2>
          <div className="space-y-3">
            {server.tools.map((tool) => (
              <div key={tool.id} className="flex items-start gap-3">
                <span className="shrink-0 text-xs font-mono bg-white/[0.06] text-emerald-400 px-2 py-1 rounded mt-0.5">
                  {tool.name}
                </span>
                {tool.description && (
                  <p className="text-sm text-gray-400 pt-0.5">{tool.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Install snippet */}
      <div className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Claude Desktop Config</h2>
        <p className="text-xs text-gray-500 mb-3">
          Add this to your <code className="font-mono text-gray-400">claude_desktop_config.json</code>:
        </p>
        <pre className="text-xs font-mono text-gray-300 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
          {installSnippet}
        </pre>
        <p className="text-xs text-gray-600 mt-2">
          Refer to the{" "}
          <a href={server.github_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
            repo README
          </a>{" "}
          for exact installation instructions.
        </p>
      </div>
    </div>
  );
}
