import { Match, Tour } from "./types";

// ---------------------------------------------------------------------------
// Tennis API - ATP WTA ITF (RapidAPI, provider: matchstat.com)
//
// This client is written against a REAL confirmed response — not a guess.
// getTournamentResults for tournament 18440 (a past Wimbledon) was tested
// directly in the RapidAPI dashboard and returned exactly the shape mapped
// below: { data: { singles: [...], doubles: [...], qualifying: [...] } },
// each entry with player1Id/player2Id, match_winner, a compact `result`
// string like "6-3 6-7(4) 7-6(2)", and result_type ("completed" |
// "retired" | "walkover" | ...).
//
// Two things this provider does NOT return, confirmed from that same
// response, so don't expect them without more work:
//   - Player seeds/rankings (there's a separate "Get Tournament Seeds"
//     endpoint you could join in later by player id — not wired up yet;
//     seeding stays optional in the ranking model, it's only a tie-breaker).
//   - Break-point counts or any other box-score stats. There's no
//     per-match stats endpoint confirmed yet. Ranking already captures the
//     same "how tense was this" signal a different way — tiebreak count,
//     comebacks, and how close the match went to full distance — so this
//     isn't a blocker, just an honest gap versus the original ask.
//
// The path below is now confirmed against the provider's own docs
// (tennisapidoc.matchstat.com/tournaments): Get Tournament Results lives at
// `/tennis/v2/{tour_type}/tournament/results/{season_id}` — note it's
// "tournament/results", not "results/tournament" (an earlier guess-by-
// analogy from the fixtures endpoint had this backwards). `season_id` is
// the numeric id of ONE year's edition of a tournament — e.g. the calendar
// endpoint's `id` field for a given row (not its `link` field, which is a
// different cross-reference and not what these tournament/{noun}/{id}
// endpoints expect).
// ---------------------------------------------------------------------------

const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || "tennis-api-atp-wta-itf.p.rapidapi.com";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";

function resultsPath(tour: "atp" | "wta", seasonId: string): string {
  return `/tennis/v2/${tour}/tournament/results/${seasonId}`;
}

async function rapidGet(path: string): Promise<any> {
  if (!RAPIDAPI_KEY) {
    throw new Error("RAPIDAPI_KEY is not set. Add it to your environment (.env.local or Vercel project settings).");
  }
  const url = `https://${RAPIDAPI_HOST}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RapidAPI request failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`);
  }

  return res.json();
}

/**
 * Parses the compact score string this provider uses, e.g.
 * "1-6 7-6(6) 6-1 3-6 6-4" or "6-4 6-2 ret." — space-separated sets, each
 * "gamesA-gamesB" with an optional "(tiebreakPoints)" suffix when that set
 * went to a breaker. Trailing tokens like "ret." don't parse as a set and
 * are silently dropped, which is what we want.
 */
function parseResultString(result: string): Match["sets"] {
  return result
    .trim()
    .split(/\s+/)
    .map((part) => {
      const tiebreak = part.includes("(");
      const clean = part.replace(/\(.*?\)/, "");
      const [aStr, bStr] = clean.split("-");
      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);
      return { a, b, tiebreak };
    })
    .filter((s) => !Number.isNaN(s.a) && !Number.isNaN(s.b));
}

function mapRawMatch(raw: any, tour: Tour, tournamentLabel: string): Match | null {
  // A walkover means no tennis was actually played — nothing to rank or
  // recommend, so drop it entirely rather than surfacing an empty "match."
  if (raw.result_type === "walkover") return null;

  const sets = parseResultString(raw.result || "");
  if (sets.length === 0) return null;

  const winner: "A" | "B" = raw.match_winner === raw.player1Id ? "A" : "B";
  const completedDate = String(raw.date || "").slice(0, 10);

  return {
    id: String(raw.id),
    tour,
    tournament: tournamentLabel,
    // roundId is a provider-internal number (e.g. qualifying rounds are
    // low numbers, the final is the highest). There's a rounds-lookup
    // endpoint under "Miscellaneous" in the docs that would turn this into
    // "QF" / "SF" / "F" text — not wired up yet, so this shows as a plain
    // number for now. Cosmetic only; doesn't affect ranking.
    round: `Round ${raw.roundId ?? "?"}`,
    playerA: raw.player1?.name ?? "Unknown",
    playerB: raw.player2?.name ?? "Unknown",
    // Not returned by this endpoint — see the file header note. Ranking
    // still works correctly with these unset; seeding is a tie-breaker
    // only, never part of the primary drama score.
    seedA: null,
    seedB: null,
    winner,
    sets,
    completedDate,
    hotShot: null,
    resultType: raw.result_type,
  };
}

export interface TournamentIds {
  /** The provider's per-year "season_id" for this tournament's ATP edition
   * (e.g. the `id` field from a Get Tournament Calendar row) — not a
   * general/recurring tournament id, a specific year's instance of it. */
  atpTournamentId?: string | null;
  /** Same idea as atpTournamentId, for the WTA edition. */
  wtaTournamentId?: string | null;
  tournamentLabel?: string;
}

/**
 * Pulls every singles result for one tournament (one call covers the whole
 * event, from qualifying through the final) and filters down to matches
 * that completed on the given date.
 *
 * Tournament ids are normally passed in by the caller — the cron route
 * reads them from Supabase's `tournaments` table (see lib/supabase.ts,
 * getActiveTournament) so they can be fixed without a redeploy. If none are
 * passed, this falls back to TOURNAMENT_ID_ATP / TOURNAMENT_ID_WTA env vars,
 * which is what the local dry-run script (scripts/run-daily-local.ts) uses
 * for quick testing.
 */
export async function getCompletedMatchesForDate(targetDate: string, ids: TournamentIds = {}): Promise<Match[]> {
  const atpId = ids.atpTournamentId ?? process.env.TOURNAMENT_ID_ATP ?? "";
  const wtaId = ids.wtaTournamentId ?? process.env.TOURNAMENT_ID_WTA ?? "";
  const tournamentLabel = ids.tournamentLabel ?? process.env.TOURNAMENT_LABEL ?? "US Open";

  const calls: Promise<Match[]>[] = [];

  if (atpId) {
    calls.push(
      rapidGet(resultsPath("atp", atpId))
        .then((data) => (data?.data?.singles ?? []) as any[])
        .then((rows) => rows.map((r) => mapRawMatch(r, "ATP", tournamentLabel)))
        .catch((err) => {
          console.error("[rapidapi] ATP results fetch failed:", err.message);
          return [];
        })
    );
  }

  if (wtaId) {
    calls.push(
      rapidGet(resultsPath("wta", wtaId))
        .then((data) => (data?.data?.singles ?? []) as any[])
        .then((rows) => rows.map((r) => mapRawMatch(r, "WTA", tournamentLabel)))
        .catch((err) => {
          console.error("[rapidapi] WTA results fetch failed:", err.message);
          return [];
        })
    );
  }

  if (calls.length === 0) {
    throw new Error(
      "No tournament ids available — set them in the Supabase `tournaments` table (active row) or as " +
        "TOURNAMENT_ID_ATP / TOURNAMENT_ID_WTA env vars for local testing."
    );
  }

  const results = await Promise.all(calls);
  return results
    .flat()
    .filter((m): m is Match => m !== null)
    .filter((m) => m.completedDate === targetDate);
}
