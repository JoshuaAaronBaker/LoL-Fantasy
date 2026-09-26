import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-zinc-300",
        className,
      )}
      {...props}
    />
  );
}
