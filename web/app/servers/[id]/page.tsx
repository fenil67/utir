import Link from "next/link";
import { notFound } from "next/navigation";
import { getServer, getMonitorEvents } from "@/lib/api";
import TrustBadge from "@/components/TrustBadge";
import ServerDetailTabs from "@/components/ServerDetailTabs";

interface Props {
  params: Promise<{ id: string }>;
}

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

  const monitorEvents = await getMonitorEvents(id)
    .then((r) => r.data)
    .catch(() => []);

  const repoName = server.name?.split("/").pop() ?? server.name;

  const installSnippet = JSON.stringify(
    {
      mcpServers: {
        [repoName ?? "server"]: {
          command: server.language === "Python" ? "python" : "npx",
          args:
            server.language === "Python"
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

      {/* Monitor warning banner */}
      {server.monitor_flag && (
        <div
          className={`rounded-xl p-4 mb-6 flex items-start gap-3 ${
            server.monitor_flag === "critical"
              ? "bg-red-500/10 border border-red-500/25"
              : "bg-yellow-500/10 border border-yellow-500/25"
          }`}
        >
          <svg
            className={`w-5 h-5 mt-0.5 shrink-0 ${
              server.monitor_flag === "critical" ? "text-red-400" : "text-yellow-400"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div>
            <p
              className={`text-sm font-semibold mb-0.5 ${
                server.monitor_flag === "critical" ? "text-red-400" : "text-yellow-400"
              }`}
            >
              {server.monitor_flag === "critical" ? "Security alert" : "Monitoring warning"}
            </p>
            {server.latest_monitor_event ? (
              <p className="text-xs text-gray-400">
                {server.latest_monitor_event.detail ??
                  "A change was detected in this server since its last scan."}{" "}
                <span className="text-gray-600">
                  Detected{" "}
                  {new Date(server.latest_monitor_event.detected_at).toLocaleDateString()}
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                A change was detected in this server since its last scan. Review before
                installing.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Back */}
      <Link
        href="/servers"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>
        <TrustBadge score={server.trust_score} size="lg" />
      </div>

      {/* Tabs */}
      <ServerDetailTabs
        server={server}
        monitorEvents={monitorEvents}
        installSnippet={installSnippet}
      />
    </div>
  );
}
