import Link from "next/link";
import type { Server } from "@/lib/api";
import TrustBadge from "./TrustBadge";

interface ServerCardProps {
  server: Server;
  variant?: "row" | "card";
}

function AuthTierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    A: "bg-emerald-500/15 text-emerald-400",
    B: "bg-blue-500/15 text-blue-400",
    C: "bg-yellow-500/15 text-yellow-400",
    F: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${colors[tier] ?? "bg-gray-700 text-gray-400"}`}>
      Auth {tier}
    </span>
  );
}

function LanguageBadge({ language }: { language: string | null }) {
  if (!language) return null;
  return (
    <span className="inline-flex items-center text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded">
      {language}
    </span>
  );
}

export default function ServerCard({ server, variant = "card" }: ServerCardProps) {
  const name = server.name?.split("/").pop() ?? server.name;

  if (variant === "row") {
    return (
      <Link
        href={`/servers/${server.id}`}
        className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-white/5 transition-colors group"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white group-hover:text-emerald-400 transition-colors truncate">
              {name}
            </span>
            <LanguageBadge language={server.language} />
            <AuthTierBadge tier={server.auth_tier} />
          </div>
          {server.description && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{server.description}</p>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-gray-500 tabular-nums">
            ★ {server.stars.toLocaleString()}
          </span>
          <TrustBadge score={server.trust_score} size="sm" />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/servers/${server.id}`}
      className="block p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.05] transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-white group-hover:text-emerald-400 transition-colors truncate">
            {name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {server.owner}
          </p>
        </div>
        <TrustBadge score={server.trust_score} size="md" />
      </div>

      {server.description && (
        <p className="text-sm text-gray-400 line-clamp-2 mb-3">{server.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <LanguageBadge language={server.language} />
        <AuthTierBadge tier={server.auth_tier} />
        {(server.findings_count ?? 0) > 0 && (
          <span className="text-xs text-orange-400/80 bg-orange-500/10 px-2 py-0.5 rounded">
            {server.findings_count} finding{server.findings_count !== 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-xs text-gray-500 tabular-nums">★ {server.stars.toLocaleString()}</span>
      </div>
    </Link>
  );
}
