import type { Metadata } from "next";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { Globe2, LogOut, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { logoutAction } from "@/app/auth/actions";
import { getOperatorViewer } from "@/lib/operators/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoL Fantasy",
  description: "Build World Championship fantasy rosters and compete on one global leaderboard.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let user: User | null = null;
  let isOperator = false;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
    isOperator = Boolean(user && await getOperatorViewer());
  } catch {
    user = null;
  }
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
              <nav className="flex items-center gap-2">
                <Link href="/worlds" className="hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider text-zinc-400 transition hover:bg-white/5 hover:text-white sm:flex"><Globe2 className="size-3.5" />Worlds</Link>
                {user ? <>
                  {isOperator && <Link href="/ops/worlds" className="hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider text-cyan-300 transition hover:bg-white/5 hover:text-cyan-200 lg:flex"><ShieldCheck className="size-3.5" />Ops</Link>}
                  <Link href="/worlds#standings" className="hidden rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider text-zinc-400 transition hover:bg-white/5 hover:text-white md:block">Standings</Link>
                  <span className="hidden items-center gap-2 text-xs font-bold text-zinc-500 sm:flex"><UserRound className="size-3.5" />{String(user.user_metadata?.username ?? "Player")}</span>
                  <form action={logoutAction}><button type="submit" aria-label="Log out" className="grid size-9 place-items-center rounded-lg border border-white/8 text-zinc-500 transition hover:text-rose-300"><LogOut className="size-4" /></button></form>
                </> : <>
                  <Link href="/login" className="rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider text-zinc-400 hover:text-white">Log in</Link>
                  <Link href="/register" className="rounded-lg bg-lime-300 px-3 py-2 text-xs font-black uppercase tracking-wider text-zinc-950 hover:bg-lime-200">Sign up</Link>
                </>}
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
