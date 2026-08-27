import { createClient } from "@supabase/supabase-js";
import { DailyDigest, Match, RankedMatch } from "./types";

// Every call site in this app runs server-side only (Next.js server
// components + route handlers) — the homepage is a server component and
// the cron route is a server route, so nothing here ever reaches the
// browser. One service-role client covers both reads and writes; there's
// no need for a separate public/anon key.
function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function publicClient() {
  return serverClient();
}

export interface TournamentConfig {
  slug: string;
  label: string;
  atpTournamentId: string | null;
  wtaTournamentId: string | null;
}

/**
 * The tournament the cron job should pull from right now, read from the
 * `tournaments` table (see supabase/schema.sql) rather than only env vars —
 * so it can be fixed or swapped from Supabase's Table Editor with no
 * redeploy. Returns null if the table is empty or has no active row, in
 * which case callers fall back to env vars (see lib/rapidapi.ts).
 */
export async function getActiveTournament(): Promise<TournamentConfig | null> {
  const supabase = serverClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Supabase fetch tournament failed: ${error.message}`);
  if (!data) return null;

  return {
    slug: data.slug,
    label: data.label,
    atpTournamentId: data.atp_tournament_id,
    wtaTournamentId: data.wta_tournament_id,
  };
}

export async function saveDailyDigest(digest: DailyDigest): Promise<void> {
  const supabase = serverClient();

  const rows = digest.matches.map((m) => ({
    id: m.id,
    tour: m.tour,
    tournament: m.tournament,
    round: m.round,
    player_a: m.playerA,
    player_b: m.playerB,
    seed_a: m.seedA,
    seed_b: m.seedB,
    winner: m.winner,
    sets: m.sets,
    completed_date: m.completedDate,
    hot_shot: m.hotShot ?? null,
    drama_score: m.dramaScore,
    drama_reasons: m.dramaReasons,
    suggested_start: m.suggestedStart,
    estimated_minutes: m.estimatedMinutes,
  }));

  const { error: matchesError } = await supabase.from("matches").upsert(rows, { onConflict: "id" });
  if (matchesError) throw new Error(`Supabase upsert matches failed: ${matchesError.message}`);

  const { error: digestError } = await supabase.from("daily_digests").upsert(
    {
      digest_date: digest.digestDate,
      tournament: digest.tournament,
      ranked_match_ids: digest.matches.map((m) => m.id),
      generated_at: digest.generatedAt,
    },
    { onConflict: "digest_date" }
  );
  if (digestError) throw new Error(`Supabase upsert digest failed: ${digestError.message}`);
}

export async function markInstagramPosted(digestDate: string, mediaId: string): Promise<void> {
  const supabase = serverClient();
  const { error } = await supabase
    .from("daily_digests")
    .update({ instagram_media_id: mediaId, instagram_posted_at: new Date().toISOString() })
    .eq("digest_date", digestDate);
  if (error) throw new Error(`Supabase mark-posted failed: ${error.message}`);
}

export async function getLatestDigest(): Promise<DailyDigest | null> {
  return getDigest();
}

export async function getDigest(date?: string): Promise<DailyDigest | null> {
  const supabase = publicClient();

  let query = supabase.from("daily_digests").select("*");
  query = date ? query.eq("digest_date", date) : query.order("digest_date", { ascending: false }).limit(1);

  const { data: digestRow, error: digestError } = await query.maybeSingle();

  if (digestError) throw new Error(`Supabase fetch digest failed: ${digestError.message}`);
  if (!digestRow) return null;

  const ids: string[] = digestRow.ranked_match_ids ?? [];
  const { data: matchRows, error: matchesError } = await supabase.from("matches").select("*").in("id", ids);
  if (matchesError) throw new Error(`Supabase fetch matches failed: ${matchesError.message}`);

  const byId = new Map((matchRows ?? []).map((r: any) => [r.id, r]));
  const matches: RankedMatch[] = ids
    .map((id, i) => {
      const r = byId.get(id);
      if (!r) return null;
      const match: RankedMatch = {
        id: r.id,
        tour: r.tour,
        tournament: r.tournament,
        round: r.round,
        playerA: r.player_a,
        playerB: r.player_b,
        seedA: r.seed_a,
        seedB: r.seed_b,
        winner: r.winner,
        sets: r.sets,
        completedDate: r.completed_date,
        hotShot: r.hot_shot,
        dramaScore: Number(r.drama_score),
        dramaReasons: r.drama_reasons ?? [],
        rank: i + 1,
        suggestedStart: r.suggested_start ?? "",
        estimatedMinutes: r.estimated_minutes ?? 0,
      };
      return match;
    })
    .filter((m): m is RankedMatch => m !== null);

  return {
    digestDate: digestRow.digest_date,
    tournament: digestRow.tournament,
    matches,
    generatedAt: digestRow.generated_at,
  };
}
