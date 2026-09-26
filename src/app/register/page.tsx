import { UserPlus } from "lucide-react";
import { registerAction } from "@/app/auth/actions";
import { AuthForm } from "@/components/auth-form";
import { Card } from "@/components/ui/card";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const returnTo = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <Card className="w-full p-7 sm:p-9">
        <span className="grid size-11 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300"><UserPlus className="size-5" /></span>
        <h1 className="mt-6 text-3xl font-black tracking-tight text-white">Create your account</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Pick a unique username and start drafting. No email is collected.</p>
        <AuthForm mode="register" action={registerAction} returnTo={returnTo} />
        <p className="mt-5 border-t border-white/8 pt-5 text-xs leading-5 text-zinc-600">
          Password recovery is not available in this MVP. Forgotten passwords require operator help.
        </p>
      </Card>
    </main>
  );
}

