import { Suspense } from "react";
import { getServers, type Server, type Pagination } from "@/lib/api";
import ServersClient from "@/components/ServersClient";

interface Props {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    language?: string;
    auth_tier?: string;
    min_score?: string;
  }>;
}

export default async function ServersPage({ searchParams }: Props) {
  const params = await searchParams;

  let initialServers: Server[] = [];
  let initialPagination: Pagination = { page: 1, limit: 20, total: 0, total_pages: 0 };

  try {
    const res = await getServers({
      limit: 20,
      sort: params.sort ?? "score_desc",
      language: params.language,
      auth_tier: params.auth_tier,
      min_score: params.min_score,
    });
    initialServers    = res.data;
    initialPagination = res.pagination;
  } catch {
    // API unavailable — render empty shell, client will retry
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">All Servers</h1>
        <p className="text-gray-500 text-sm">
          Confirmed MCP servers, scanned for security issues and scored 0–100.
        </p>
      </div>
      <Suspense>
        <ServersClient
          initialServers={initialServers}
          initialPagination={initialPagination}
          initialParams={params}
        />
      </Suspense>
    </div>
  );
}
