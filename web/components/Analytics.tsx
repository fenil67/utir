"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    const serverMatch = pathname.match(/^\/servers\/([^/]+)/);
    const potentialId = serverMatch?.[1];
    const server_id   = potentialId && UUID_RE.test(potentialId) ? potentialId : null;

    fetch(`${API_BASE}/api/analytics/pageview`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        path:       pathname,
        server_id:  server_id ?? null,
        referrer:   document.referrer || null,
        user_agent: navigator.userAgent,
      }),
    })
      .then(r => { if (!r.ok) console.log("Analytics failed:", r.status); })
      .catch(err => console.log("Analytics error:", err));
  }, [pathname]);

  return null;
}
