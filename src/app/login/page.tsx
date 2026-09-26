import { LogIn } from "lucide-react";
import { loginAction } from "@/app/auth/actions";
import { AuthForm } from "@/components/auth-form";
import { Card } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const returnTo = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <Card className="w-full p-7 sm:p-9">
        <span className="grid size-11 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><LogIn className="size-5" /></span>
        <h1 className="mt-6 text-3xl font-black tracking-tight text-white">Welcome back</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Log in to build your Worlds lineups and track the global standings.</p>
        <AuthForm mode="login" action={loginAction} returnTo={returnTo} />
      </Card>
    </main>
  );
}
