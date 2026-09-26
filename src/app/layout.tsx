import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoL Fantasy Pipeline",
  description: "Completed-game ingestion and deterministic fantasy scoring proof of concept.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="data-grid min-h-screen">
          <header className="border-b border-white/8 bg-black/20 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-3 font-black tracking-tight">
                <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
                  <Trophy className="size-4" aria-hidden="true" />
                </span>
                <span>LoL Fantasy</span>
              </Link>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                Pipeline proof
              </span>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
