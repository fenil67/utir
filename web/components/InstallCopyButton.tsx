"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function InstallCopyButton({
  snippet,
  serverId,
}: {
  snippet: string;
  serverId: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = snippet;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    // Fire install event (best-effort)
    fetch(`${API_BASE}/api/dashboard/install-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_id: serverId }),
    }).catch(() => {});

    // Track install copy as a pageview with special path for analytics
    fetch(`${API_BASE}/api/analytics/pageview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path:       `/servers/${serverId}/install`,
        server_id:  serverId,
        referrer:   document.referrer || null,
        user_agent: navigator.userAgent,
      }),
    }).catch(() => {});
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1.5"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-emerald-400">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy config
        </>
      )}
    </button>
  );
}
