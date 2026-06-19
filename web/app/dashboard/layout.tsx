import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-8 pb-6 border-b border-white/10">
        <Link href="/dashboard" className="text-sm font-semibold text-white">
          Publisher Dashboard
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-sm text-gray-500">My servers</span>
      </div>
      {children}
    </div>
  );
}
