import Link from "next/link";
import { ArrowRight, Braces, Globe2, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-3xl">
        <Badge className="border-lime-300/20 bg-lime-300/8 text-lime-300"><Globe2 className="mr-1.5 size-3" />World Championship Fantasy</Badge>
        <h1 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.04em] text-white sm:text-6xl">
          Draft the five.
          <br />Own every fight.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          Redraft a role-complete roster through every World Championship stage. Stay under the cap, follow the surviving teams, and climb one global leaderboard.
        </p>
        <Link href="/worlds" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-lime-300 px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-lime-200">Enter Worlds <ArrowRight className="size-4" /></Link>
      </div>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          [Users, "Five roles", "Draft one starter at Top, Jungle, Mid, Bot, and Support."],
          [Braces, "Smart pricing", "Role-balanced prices turn performance into meaningful choices."],
          [ShieldCheck, "Server verified", "Every lineup is re-priced and validated when you submit."],
        ].map(([Icon, title, description]) => {
          const Component = Icon as typeof Users;
          return (
            <Card key={String(title)} className="p-5">
              <Component className="size-5 text-zinc-500" aria-hidden="true" />
              <h3 className="mt-4 font-bold text-zinc-100">{String(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{String(description)}</p>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
