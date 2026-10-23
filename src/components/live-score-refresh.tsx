"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CircleDot, RefreshCw, TriangleAlert } from "lucide-react";

interface LiveScoreRefreshProps {
  active: boolean;
  lastSyncAt: string | null;
  intervalMs?: number;
}

function relativeTime(timestamp: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(timestamp).valueOf()) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function LiveScoreRefresh({ active, lastSyncAt, intervalMs = 30_000 }: LiveScoreRefreshProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      startRefresh(() => {
        router.refresh();
      });
    };
    const timer = window.setInterval(refresh, intervalMs);
    const clock = window.setInterval(() => setNow(Date.now()), 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, intervalMs, router, startRefresh]);

  const stale = useMemo(() => {
    if (!active || !lastSyncAt) return false;
    return now - new Date(lastSyncAt).valueOf() > Math.max(intervalMs * 4, 10 * 60_000);
  }, [active, intervalMs, lastSyncAt, now]);

  if (!active) return null;
  return (
    <div
      role="status"
      className={`inline-flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${stale ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-200" : "border-rose-300/20 bg-rose-300/[0.06] text-rose-200"}`}
    >
      {stale ? <TriangleAlert className="size-3.5" /> : <CircleDot className="size-3.5 animate-pulse" />}
      <span>{stale ? "Score feed may be stale" : "Live scoring"}</span>
      <span className="text-zinc-500">
        {lastSyncAt ? `checked ${relativeTime(lastSyncAt, now)}` : "awaiting first sync"}
      </span>
      <RefreshCw className={`size-3 text-zinc-600 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
    </div>
  );
}
