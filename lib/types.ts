// Core domain types for Spoiler Free Tennis.
// These are intentionally decoupled from whatever shape the RapidAPI
// response happens to be in — lib/rapidapi.ts is responsible for mapping
// raw API data into this shape (see the mapping notes in that file).

export type Tour = "ATP" | "WTA";

export interface SetScore {
  /** Games won by player A / player B in this set. */
  a: number;
  b: number;
  /** True if this set was decided by a tiebreak. */
  tiebreak: boolean;
  /** Tiebreak points, if known (e.g. "7-4"). Optional — not always available. */
  tiebreakScore?: string;
}

export interface Match {
  /** Stable id from the source API, used for de-duping and DB upserts. */
  id: string;
  tour: Tour;
  tournament: string;
  round: string; // e.g. "R32", "QF", "SF", "F"
  playerA: string;
  playerB: string;
  /** Seed/ranking, lower is more prominent. Null if unseeded/unknown.
   * NOT used anywhere in lib/ranking.ts — kept only in case you want it for
   * display (e.g. "the #3 seed") later. Match quality alone decides rank. */
  seedA: number | null;
  seedB: number | null;
  winner: "A" | "B";
  sets: SetScore[];
  /** ISO date (yyyy-mm-dd) the match completed, used to bucket "previous 24h". */
  completedDate: string;
  /** Optional manually-curated note, e.g. a Hot Shot description. See README. */
  hotShot?: string | null;
  /** "completed" | "retired" | "walkover" | other provider-specific values.
   * Walkovers are filtered out before this type is ever constructed (see
   * lib/rapidapi.ts) — matches with the provider's actual value are kept so
   * a retirement can still surface, just labeled honestly. Not available
   * from the Draws endpoint (see mapRawDrawsMatch) — undefined there. */
  resultType?: string;
  /** Match-level break point totals, summed across both players. Only
   * populated when the match came from getTournamentDraws (see
   * mapRawDrawsMatch in lib/rapidapi.ts) — getTournamentResults doesn't
   * return this, so it's null/undefined for matches from that endpoint.
   * totalFaced = combined break point chances created by both players;
   * totalSaved = totalFaced minus however many were actually converted. */
  breakPoints?: { totalFaced: number; totalSaved: number } | null;
}

export interface RankedMatch extends Match {
  dramaScore: number;
  dramaReasons: string[];
  /** 1 = most worth watching. */
  rank: number;
  /** dramaScore normalized to a 1.0-9.9 "curator's rating" — see lib/ranking.ts. */
  rating: number;
  /** Short label shown next to the rating: "Match of the Day" (rank 1),
   * "Hot Shots" (has a recorded Hot Shot), or "Drama" otherwise. */
  tag: string;
  /** Suggested pacing slot for today's viewing queue, e.g. "7:00 PM". */
  suggestedStart: string;
  /** Rough estimated watch length in minutes, used only to build the queue. */
  estimatedMinutes: number;
}

export interface DailyDigest {
  /** The date (yyyy-mm-dd) these matches were completed. */
  digestDate: string;
  tournament: string;
  matches: RankedMatch[];
  generatedAt: string; // ISO timestamp
}
