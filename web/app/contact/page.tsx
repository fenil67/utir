"use client";

import { useState } from "react";

const CATEGORIES = [
  "Publisher inquiry",
  "Security concern",
  "Bug report",
  "Feature request",
  "General question",
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", category: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.message.length < 20) {
      setError("Message must be at least 20 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submission failed");
      setSuccess(json.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Contact us</h1>
        <p className="text-gray-400 text-base">
          Questions, bug reports, publisher inquiries, or security concerns — we&apos;re here to help.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        {/* Form */}
        <div className="md:col-span-3">
          {success ? (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-6">
              <p className="text-emerald-400 font-medium mb-1">Message sent!</p>
              <p className="text-gray-400 text-sm">{success}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Name</label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/25 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/25 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
                <select
                  required
                  value={form.category}
                  onChange={e => set("category", e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/25 transition-colors appearance-none"
                >
                  <option value="" disabled className="bg-[#1a1a1a]">Select a category</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c} className="bg-[#1a1a1a]">{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Message</label>
                <textarea
                  required
                  minLength={20}
                  rows={5}
                  value={form.message}
                  onChange={e => set("message", e.target.value)}
                  placeholder="Describe your question or issue..."
                  className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/25 transition-colors resize-none"
                />
                {form.message.length > 0 && form.message.length < 20 && (
                  <p className="text-xs text-gray-600 mt-1">{20 - form.message.length} more characters needed</p>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : "Send message"}
              </button>
            </form>
          )}
        </div>

        {/* Info cards */}
        <div className="md:col-span-2 space-y-3">
          {[
            {
              title: "Publisher support",
              body: "Submit your MCP server, claim ownership, or get help with your trust score.",
            },
            {
              title: "Security reports",
              body: "Found a vulnerability or suspicious server? Report it and we'll investigate within 24 hours.",
            },
            {
              title: "Response time",
              body: "We respond to all inquiries within 48 hours. For urgent security issues, expect same-day response.",
            },
          ].map(({ title, body }) => (
            <div key={title} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
              <p className="text-sm font-semibold text-white mb-1">{title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
