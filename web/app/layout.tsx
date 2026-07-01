import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import NavAuthButtons from "@/components/NavAuthButtons";
import Analytics from "@/components/Analytics";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "utir — MCP Server Trust Registry",
  description: "Find safe MCP servers. Every repo scanned for security issues, auth implementation, and dependency vulnerabilities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
        <body className="min-h-full flex flex-col bg-[#0f0f0f] text-gray-100 antialiased">
          <header className="border-b border-white/10 px-6 py-4">
            <nav className="max-w-6xl mx-auto flex items-center justify-between">
              <Link href="/" className="text-white font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity">
                utir
              </Link>
              <div className="flex items-center gap-6 text-sm text-gray-400">
                <Link href="/servers" className="hover:text-white transition-colors">Servers</Link>
                <Link href="/search" className="hover:text-white transition-colors">Search</Link>
                <Link href="/submit" className="hover:text-white transition-colors">Submit</Link>
                <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
                <NavAuthButtons />
              </div>
            </nav>
          </header>
          <Analytics />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-gray-600">
            utir — MCP Server Trust Registry
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
