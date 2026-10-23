import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const sql = getDatabase();
    const rows = await sql<Array<{ database_time: string }>>`
      select clock_timestamp()::text as database_time
    `;
    return Response.json(
      {
        status: "ok",
        database: "reachable",
        databaseTime: rows[0].database_time,
        release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
