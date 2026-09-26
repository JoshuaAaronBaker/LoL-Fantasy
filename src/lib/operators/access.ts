import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/lib/db/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getOperatorViewer = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const rows = await getDatabase()<Array<{ user_id: string }>>`
    select user_id from fantasy_operators where user_id = ${user.id}
  `;
  return rows[0] ? { userId: user.id } : null;
});

export async function requireOperator() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/ops/worlds");
  const rows = await getDatabase()<Array<{ user_id: string }>>`
    select user_id from fantasy_operators where user_id = ${user.id}
  `;
  if (!rows[0]) notFound();
  return { userId: user.id };
}
