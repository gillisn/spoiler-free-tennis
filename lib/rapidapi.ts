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
// One thing this endpoint does NOT return, confirmed from that same
// response: player seeds/rankings (there's a separate "Get Tournament
// Seeds" endpoint you could join in later by player id — not wired up, and
// not needed either, since seeding isn't used anywhere in lib/ranking.ts).
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
//
// getTournamentDraws (below, mapRawDrawsMatch/getCompletedMatchesForDateViaDraws)
// is a SEPARATE endpoint confirmed from a real 2026 EFG Swiss Open - Gstaad
// response, and it DOES include break-point stats (breakPointsConverted /
// breakPointsConvertedOf per player) plus a lot more box-score detail
// (aces, first-serve %, etc.) that Results doesn't have. Its shape is
// different enough from Results that it gets its own mapper rather than
// reusing mapRawMatch. Crucially, it's also looked up differently: by
// TOURNAMENT NAME + year, not by season_id — see drawsPath below. This is
// wired up and ready, but not yet what the live cron uses (see README
// section 7) — needs one confirmed real call for the actual US Open name
// string before flipping the switch, since a wrong/unencoded name is
// exactly what made an earlier direct attempt at this endpoint come back
// blank.
// ---------------------------------------------------------------------------

function resultsPath(tour: "atp" | "wta", seasonId: string): string {
  return `/tennis/v2/${tour}/tournament/results/${seasonId}`;
}

async function rapidGet(path: string): Promise<any> {
  // Read these INSIDE the function, not at module-load time (top of file).
  // Reason: this file gets imported before scripts/run-daily-local.ts's
  // dotenv.config() call finishes populating process.env, so a top-level
  // `const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY` here would have
  // permanently captured an empty string — reading it lazily, at the
  // moment a request is actually made, sidesteps that ordering problem
  // entirely (and costs nothing, since this only runs a couple times/day).
  const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || "tennis-api-atp-wta-itf.p.rapidapi.com";
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";

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

/**
 * Draws endpoint path. Looked up by tournament NAME + year, not season_id —
 * confirmed against the docs and a real response. Only spaces need
 * encoding (periods/hyphens are safe raw in a URL path) — but the name has
 * to match what the provider expects exactly (e.g. "U.S. Open - New York",
 * not "USOpen" or "US Open" necessarily — untested for this specific event,
 * see the file header note above).
 */
function drawsPath(tour: "atp" | "wta", tournamentName: string, year: number): string {
  // encodeURIComponent already turns spaces into %20 and leaves "." and "-"
  // alone (both unreserved), which matches what's confirmed to work.
  return `/tennis/v2/tournament/${tour}/${encodeURIComponent(tournamentName)}/${year}/draws`;
}

/**
 * Maps one match from getTournamentDraws's shape — quite different from
 * getTournamentResults (see mapRawMatch above). Confirmed against a real
 * 2026 EFG Swiss Open - Gstaad response. Key differences handled here:
 *   - No `id` field on the match itself — built from tournamentId + roundId
 *     + both player ids instead, which is stable and always present.
 *   - No `match_winner` field — inferred directly from the parsed set
 *     scores (whoever won more sets), which sidesteps the never-fully-
 *     resolved "player1 is always the winner" ambiguity noted for Results.
 *   - No `result_type` field — retirements aren't distinguishable here, so
 *     resultType is left undefined for Draws-sourced matches.
 *   - Unplayed/bye slots show up as real array entries with an empty
 *     `result`, empty `date`, and `player2: null` — filtered out below,
 *     same idea as filtering walkovers in mapRawMatch.
 *   - Break points ARE here: player.stats.breakPointsConverted /
 *     breakPointsConvertedOf, confirmed non-null for both players on every
 *     completed match in the sample response. See lib/ranking.ts for how
 *     this factors into the score.
 */
function mapRawDrawsMatch(raw: any, tour: Tour, tournamentLabel?: string): Match | null {
  if (!raw.result || !raw.date || !raw.player1 || !raw.player2) return null;

  const sets = parseResultString(raw.result);
  if (sets.length === 0) return null;

  const setsWonA = sets.filter((s) => s.a > s.b).length;
  const setsWonB = sets.filter((s) => s.b > s.a).length;
  const winner: "A" | "B" = setsWonA >= setsWonB ? "A" : "B";

  const p1Stats = raw.player1.stats ?? {};
  const p2Stats = raw.player2.stats ?? {};
  const bp1Of = p1Stats.breakPointsConvertedOf;
  const bp2Of = p2Stats.breakPointsConvertedOf;
  const breakPoints =
    typeof bp1Of === "number" && typeof bp2Of === "number"
      ? {
          totalFaced: bp1Of + bp2Of,
          totalSaved: bp1Of + bp2Of - (p1Stats.breakPointsConverted ?? 0) - (p2Stats.breakPointsConverted ?? 0),
        }
      : null;

  return {
    id: `${raw.tournamentId}-${raw.roundId}-${raw.player1Id}-${raw.player2Id}`,
    tour,
    tournament: tournamentLabel ?? raw.tournament?.name ?? "",
    round: `Round ${raw.roundId ?? "?"}`,
    playerA: raw.player1.name ?? "Unknown",
    playerB: raw.player2.name ?? "Unknown",
    seedA: null,
    seedB: null,
    winner,
    sets,
    completedDate: String(raw.date).slice(0, 10),
    hotShot: null,
    resultType: undefined,
    breakPoints,
  };
}

export interface DrawsLookup {
  tour: "atp" | "wta";
  /** Exact provider tournament name, e.g. "U.S. Open - New York" — not
   * necessarily the casual name. Confirm with a real test call first. */
  tournamentName: string;
  year: number;
  tournamentLabel?: string;
}

/**
 * Alternate to getCompletedMatchesForDate, sourced from getTournamentDraws
 * instead of getTournamentResults — same idea (pull everything, filter by
 * date), but via name+year lookup instead of season_id, and with break
 * points included. Not yet used by the live cron (see README section 7) —
 * confirm a real call works for the target tournament's exact name first.
 */
export async function getCompletedMatchesForDateViaDraws(
  targetDate: string | null,
  lookups: DrawsLookup[]
): Promise<Match[]> {
  const calls = lookups.map((lookup) =>
    rapidGet(drawsPath(lookup.tour, lookup.tournamentName, lookup.year))
      .then((data) => (data?.singles ?? []) as any[])
      .then((rows) =>
        rows.map((r) => mapRawDrawsMatch(r, lookup.tour === "atp" ? "ATP" : "WTA", lookup.tournamentLabel))
      )
      .catch((err) => {
        console.error(`[rapidapi] Draws fetch failed for ${lookup.tour}/${lookup.tournamentName}:`, err.message);
        return [];
      })
  );

  const results = await Promise.all(calls);
  const all = results.flat().filter((m): m is Match => m !== null);
  return targetDate === null ? all : all.filter((m) => m.completedDate === targetDate);
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
 *
 * Pass targetDate = null to skip the date filter entirely and return every
 * completed match found — useful for testing the mapping/pipeline against a
 * tournament that's already fully finished (e.g. a past Wimbledon) without
 * having to know the exact real-world date of any specific match.
 */
export async function getCompletedMatchesForDate(
  targetDate: string | null,
  ids: TournamentIds = {}
): Promise<Match[]> {
  const atpId = ids.atpTournamentId ?? process.env.TOURNAMENT_ID_ATP ?? "";
  const wtaId = ids.wtaTournamentId ?? process.env.TOURNAMENT_ID_WTA ?? "";
  const tournamentLabel = ids.tournamentLabel ?? process.env.TOURNAMENT_LABEL ?? "US Open";

  const calls: Promise<(Match | null)[]>[] = [];

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
  const all = results.flat().filter((m): m is Match => m !== null);
  return targetDate === null ? all : all.filter((m) => m.completedDate === targetDate);
}
