import { Match, RankedMatch, SetScore, Tour } from "./types";

// ---------------------------------------------------------------------------
// Drama-first ranking.
//
// Per the site's editorial rule: how dramatic the match itself was comes
// first (distance, tiebreaks, comebacks). Player seeding/ranking is used
// ONLY to break near-ties, never blended into the primary score — a great
// match between unseeded players should always be able to outrank a
// straightforward win by the #1 seed.
// ---------------------------------------------------------------------------

const MAX_SETS: Record<Tour, number> = {
  ATP: 5, // men: best of 5, full distance = 5 sets
  WTA: 3, // women: best of 3, full distance = 3 sets
};

const MIN_SETS_TO_WIN: Record<Tour, number> = {
  ATP: 3,
  WTA: 2,
};

/** Matches within this many drama points of each other are treated as tied
 * and re-ordered by player prominence instead. */
const NEAR_TIE_EPSILON = 5;

function setMargin(s: SetScore): number {
  return Math.abs(s.a - s.b);
}

export function scoreMatch(match: Match): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const maxSets = MAX_SETS[match.tour];
  const setsPlayed = match.sets.length;

  // 1) Distance: how close to the maximum possible length the match went.
  //    Up to 40 points.
  const distanceRatio = Math.min(setsPlayed / maxSets, 1);
  const distancePoints = distanceRatio * 40;
  score += distancePoints;
  if (setsPlayed >= maxSets) {
    reasons.push(
      match.tour === "ATP" ? "Went the distance — full five sets" : "Went the distance — full three sets"
    );
  } else if (setsPlayed > MIN_SETS_TO_WIN[match.tour]) {
    reasons.push(`${setsPlayed}-set match`);
  }

  // 2) Tiebreaks: each one is a high-drama, high-tension set. +12 each, capped.
  const tiebreakCount = match.sets.filter((s) => s.tiebreak).length;
  if (tiebreakCount > 0) {
    score += Math.min(tiebreakCount * 12, 36);
    reasons.push(tiebreakCount === 1 ? "One set went to a tiebreak" : `${tiebreakCount} tiebreak sets`);
  }

  // 3) Deciding-set tiebreak: the biggest possible single moment in a match.
  const lastSet = match.sets[match.sets.length - 1];
  if (lastSet?.tiebreak && setsPlayed >= MIN_SETS_TO_WIN[match.tour] + 1) {
    score += 15;
    reasons.push("Decided by a final-set tiebreak");
  }

  // 4) Comeback: lost the first set but won the match.
  const firstSet = match.sets[0];
  if (firstSet) {
    const firstSetWinner = firstSet.a > firstSet.b ? "A" : "B";
    if (firstSetWinner !== match.winner) {
      score += 20;
      reasons.push("Comeback after dropping the first set");
    }
  }

  // 5) Bigger comeback: down two sets to love (ATP only, needs 5 sets played).
  if (match.tour === "ATP" && setsPlayed >= 3) {
    const s1 = match.sets[0];
    const s2 = match.sets[1];
    const s1Winner = s1.a > s1.b ? "A" : "B";
    const s2Winner = s2.a > s2.b ? "A" : "B";
    if (s1Winner === s2Winner && s1Winner !== match.winner) {
      score += 15; // additive on top of the general comeback bonus above
      reasons.push("Came back from two sets down");
    }
  }

  // 6) Tight final set (excluding ones already flagged as a tiebreak).
  if (lastSet && !lastSet.tiebreak && setMargin(lastSet) <= 2) {
    score += 8;
    reasons.push("Tight finish in the last set");
  }

  // 7) Hot Shot on record for this match (curated or API-sourced).
  if (match.hotShot) {
    score += 10;
    reasons.push("Includes a Hot Shot");
  }

  // 8) Transparency, not a penalty: a retirement means the match didn't play
  // to its natural end, so say so rather than presenting it as a clean result.
  if (match.resultType === "retired") {
    reasons.push("Ended in retirement");
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

/** Player prominence used ONLY as a tie-breaker. Lower seed number = more
 * prominent; unseeded players contribute ~0. */
function prominence(match: Match): number {
  const p = (seed: number | null) => (seed && seed > 0 ? 1 / seed : 0);
  return p(match.seedA) + p(match.seedB);
}

export function rankMatches(matches: Match[], topN = 5): RankedMatch[] {
  const scored = matches.map((m) => {
    const { score, reasons } = scoreMatch(m);
    return { match: m, score, reasons };
  });

  scored.sort((x, y) => {
    if (Math.abs(x.score - y.score) > NEAR_TIE_EPSILON) {
      return y.score - x.score;
    }
    // Near-tie: fall back to player prominence.
    return prominence(y.match) - prominence(x.match);
  });

  const top = scored.slice(0, topN);
  const withPacing = attachWatchPacing(top);

  return withPacing.map((entry, i) => ({
    ...entry.match,
    dramaScore: entry.score,
    dramaReasons: entry.reasons,
    rank: i + 1,
    suggestedStart: entry.suggestedStart,
    estimatedMinutes: entry.estimatedMinutes,
  }));
}

// ---------------------------------------------------------------------------
// Watch pacing: since there are more good matches than time to watch replays
// live, we suggest a start time for each one in ranked order. This is a
// scheduling convenience only — it is derived from typical match length by
// format, NOT from the real-world time the match was actually played, so it
// carries no spoiler information.
// ---------------------------------------------------------------------------

function estimateMinutes(match: Match): number {
  const perSet = match.tour === "ATP" ? 45 : 40;
  const base = match.sets.length * perSet;
  const tiebreakPad = match.sets.filter((s) => s.tiebreak).length * 10;
  return Math.round(base + tiebreakPad);
}

interface Scored {
  match: Match;
  score: number;
  reasons: string[];
}

function attachWatchPacing(
  top: Scored[],
  startHour = 19 // 7:00 PM local — a reasonable "tonight's viewing" anchor
): (Scored & { suggestedStart: string; estimatedMinutes: number })[] {
  let cursorMinutes = startHour * 60;
  return top.map((entry) => {
    const estimatedMinutes = estimateMinutes(entry.match);
    const suggestedStart = formatClock(cursorMinutes);
    cursorMinutes += estimatedMinutes + 15; // 15-minute buffer between matches
    return { ...entry, suggestedStart, estimatedMinutes };
  });
}

function formatClock(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}
