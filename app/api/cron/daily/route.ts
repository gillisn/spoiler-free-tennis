import { NextRequest, NextResponse } from "next/server";
import { getCompletedMatchesForDate } from "@/lib/rapidapi";
import { rankMatches } from "@/lib/ranking";
import { saveDailyDigest, markInstagramPosted, getActiveTournament } from "@/lib/supabase";
import { postImageToInstagram, buildCaption } from "@/lib/instagram";
import { DailyDigest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Triggered once daily by Vercel Cron (see vercel.json). Pulls the previous
 * day's completed matches, ranks the top 5, stores everything in Supabase,
 * then posts the graphic + caption to Instagram.
 *
 * Protected by CRON_SECRET so it can't be triggered by randoms hitting the
 * URL — Vercel Cron sends this automatically as a Bearer token; if you
 * trigger it manually (e.g. via curl) for testing, add the same header.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targetDate = yesterday();

  try {
    // DB first (edit the `tournaments` table any time, no redeploy needed);
    // falls back to TOURNAMENT_ID_ATP / TOURNAMENT_ID_WTA / TOURNAMENT_LABEL
    // env vars if no active row exists yet — see lib/rapidapi.ts.
    const tournamentConfig = await getActiveTournament();
    const tournamentLabel = tournamentConfig?.label ?? process.env.TOURNAMENT_LABEL ?? "US Open";

    const matches = await getCompletedMatchesForDate(targetDate, {
      atpTournamentId: tournamentConfig?.atpTournamentId,
      wtaTournamentId: tournamentConfig?.wtaTournamentId,
      tournamentLabel,
    });

    if (matches.length === 0) {
      return NextResponse.json({ ok: true, message: `No completed matches found for ${targetDate}.` });
    }

    const ranked = rankMatches(matches, 5);

    const digest: DailyDigest = {
      digestDate: targetDate,
      tournament: tournamentLabel,
      matches: ranked,
      generatedAt: new Date().toISOString(),
    };

    await saveDailyDigest(digest);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not set — needed so Instagram can fetch the image.");

    // Cache-bust so Instagram doesn't fetch a stale cached image for today.
    const imageUrl = `${siteUrl}/api/og?d=${targetDate}`;
    const caption = buildCaption(digest);

    const mediaId = await postImageToInstagram(imageUrl, caption);
    await markInstagramPosted(targetDate, mediaId);

    return NextResponse.json({
      ok: true,
      digestDate: targetDate,
      matchCount: ranked.length,
      instagramMediaId: mediaId,
    });
  } catch (err: any) {
    console.error("[cron/daily] failed:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
