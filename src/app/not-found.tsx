import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <Card className="p-10">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-600">404</p>
        <h1 className="mt-3 text-2xl font-black text-white">Scored game not found</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">The game may not have been ingested yet, or the local database is unavailable.</p>
        <Link href="/" className="mt-6 inline-flex rounded-xl bg-lime-300 px-4 py-2 text-sm font-black text-zinc-950">Return home</Link>
      </Card>
    </main>
  );
}
