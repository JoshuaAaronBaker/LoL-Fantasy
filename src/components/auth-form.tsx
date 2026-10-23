"use client";

import Link from "next/link";
import Script from "next/script";
import { useActionState, useCallback, useEffect, useRef } from "react";
import type { AuthFormState } from "@/app/auth/actions";

interface AuthFormProps {
  mode: "login" | "register";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  returnTo: string;
  captchaSiteKey?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; theme: "dark" }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

function TurnstileField({ siteKey, resetSignal }: { siteKey: string; resetSignal: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, { sitekey: siteKey, theme: "dark" });
  }, [siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [renderWidget]);

  useEffect(() => {
    if (resetSignal && widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }, [resetSignal]);

  return (
    <div>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} />
      <div ref={containerRef} />
      <p className="mt-2 text-[10px] leading-4 text-zinc-600">Security check powered by Cloudflare Turnstile.</p>
    </div>
  );
}

export function AuthForm({ mode, action, returnTo, captchaSiteKey }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const registering = mode === "register";
  const alternate = registering ? "/login" : "/register";
  const alternateHref = returnTo === "/" ? alternate : `${alternate}?next=${encodeURIComponent(returnTo)}`;

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div>
        <label htmlFor="username" className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-400">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_]+"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
          placeholder="summoner_name"
        />
        {state.errors?.username?.map((error) => <p key={error} className="mt-2 text-sm text-rose-300">{error}</p>)}
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-400">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={8}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
          placeholder="At least 8 characters"
        />
        {state.errors?.password?.map((error) => <p key={error} className="mt-2 text-sm text-rose-300">{error}</p>)}
      </div>
      {captchaSiteKey && <TurnstileField siteKey={captchaSiteKey} resetSignal={state.message ? state : null} />}
      {state.message && <p role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/8 p-3 text-sm text-rose-200">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-lime-300 px-4 py-3 font-black text-zinc-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Working…" : registering ? "Create account" : "Log in"}
      </button>
      <p className="text-center text-sm text-zinc-500">
        {registering ? "Already registered?" : "Need an account?"}{" "}
        <Link href={alternateHref} className="font-bold text-cyan-300 hover:text-cyan-200">
          {registering ? "Log in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}
