import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Pinged by the Vercel cron (vercel.json) to keep the Supabase free-tier
// project from being paused for database inactivity. The query must reach
// the database itself — a plain HTTP 200 from the app is not enough.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { error } = await supabase
    .from("toilet_location")
    .select("id")
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, db: error.message },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
