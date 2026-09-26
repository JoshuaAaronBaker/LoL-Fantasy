import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-zinc-950/75 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
