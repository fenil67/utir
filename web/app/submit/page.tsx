"use client";

import { useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;

function validate(url: string): string | null {
  if (!url.trim()) return "Please enter a GitHub URL.";
  if (!GITHUB_RE.test(url.trim())) return "Please enter a valid GitHub URL.";
  return null;
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "queued";  url: string }
  | { phase: "exists";  id: string }
  | { phase: "error";   message: string };

const INFO_CARDS = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "Security scan",
    body: "We run static analysis, dependency audits, and sandbox behavioral testing on your server.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    ),
    title: "Trust score",
    body: "Your server gets a score from 0–100 based on auth implementation, security findings, and maintenance.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Listed in 24 hours",
    body: "Once scanned your server appears in the registry with its full score breakdown for developers to find.",
  },
];

export default function SubmitPage() {
  const [url,       setUrl]       = useState("");
  const [touched,   setTouched]   = useState(false);
  const [state,     setState]     = useState<State>({ phase: "idle" });

  const validationError = touched ? validate(url) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);

    const err = validate(url);
    if (err) return;

    setState({ phase: "loading" });

    try {
      const res = await fetch(`${API_BASE}/api/submit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ github_url: url.trim() }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setState({ phase: "exists", id: data.id });
        return;
      }

      if (!res.ok) {
        setState({ phase: "error", message: data.error ?? "Submission failed. Please try again." });
        return;
      }

      setState({ phase: "queued", url: url.trim() });
    } catch {
      setState({ phase: "error", message: "Could not reach the server. Please try again." });
    }
  }

  function reset() {
    setUrl("");
    setTouched(false);
    setState({ phase: "idle" });
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">

      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
          Submit your MCP server
        </h1>
        <p className="text-gray-400 max-w-md mx-auto">
          We&apos;ll scan it for security issues and list it in the registry with a trust score.
          Free for open source servers.
        </p>
      </div>

      {/* Result: queued */}
      {state.phase === "queued" && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-6 mb-8">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-emerald-400 font-semibold mb-1">Your server has been queued for scanning.</p>
              <p className="text-sm text-gray-400 mb-2">Check back in a few hours to see your trust score.</p>
              <p className="text-xs text-gray-500 font-mono break-all">{state.url}</p>
            </div>
          </div>
          <button
            onClick={reset}
            className="mt-4 text-sm text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-2"
          >
            Submit another
          </button>
        </div>
      )}

      {/* Result: already exists */}
      {state.phase === "exists" && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 p-6 mb-8">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <div>
              <p className="text-blue-400 font-semibold mb-2">This server is already in our registry.</p>
              <Link
                href={`/servers/${state.id}`}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2"
              >
                View your trust score →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Form — hidden once queued */}
      {state.phase !== "queued" && (
        <form onSubmit={handleSubmit} noValidate className="mb-12">
          <div className="mb-4">
            <label htmlFor="github-url" className="block text-sm font-medium text-gray-300 mb-2">
              GitHub repository URL
            </label>
            <input
              id="github-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="https://github.com/username/your-mcp-server"
              disabled={state.phase === "loading"}
              className={`w-full px-4 py-3 text-sm bg-white/[0.05] border rounded-xl text-white placeholder-gray-600
                focus:outline-none transition-colors disabled:opacity-50
                ${validationError
                  ? "border-red-500/60 focus:border-red-500"
                  : "border-white/15 focus:border-white/30"
                }`}
            />
            {validationError && (
              <p className="mt-2 text-sm text-red-400">{validationError}</p>
            )}
          </div>

          {/* API error */}
          {state.phase === "error" && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-400">{state.message}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={state.phase === "loading"}
            className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white
              bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50
              disabled:cursor-not-allowed transition-colors"
          >
            {state.phase === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Scanning your server…
              </span>
            ) : (
              "Scan and list my server"
            )}
          </button>
        </form>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {INFO_CARDS.map((card) => (
          <div key={card.title} className="rounded-xl bg-white/[0.03] border border-white/10 p-5">
            <div className="text-gray-400 mb-3">{card.icon}</div>
            <h3 className="text-sm font-semibold text-white mb-1">{card.title}</h3>
            <p className="text-xs text-gray-500 leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
