import { Match, RankedMatch, SetScore, Tour } from "./types";

// ---------------------------------------------------------------------------
// Drama-first ranking.
//
// Per the site's editorial rule: how dramatic the match itself was is ALL
// that matters here — distance, tiebreaks, comebacks. Player seeding/ranking
// is not used anywhere in this file, not even as a tie-breaker: quality of
// the match decides, full stop. An upset of a top seed still surfaces
// naturally when it belongs, because upsets of that kind are almost always
// close, tense matches — which is exactly what this scoring already rewards
// — not because of who the players were ranked.
// ---------------------------------------------------------------------------

const MAX_SETS: Record<Tour, number> = {
  ATP: 5, // men: best of 5, full distance = 5 sets
  WTA: 3, // women: best of 3, full distance = 3 sets
};

const MIN_SETS_TO_WIN: Record<Tour, number> = {
  ATP: 3,
  WTA: 2,
};

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
  }
  // (Matches that go beyond the minimum but not the full distance still earn
  // their distance points above — we just don't call out a bare "N-set
  // match" as a reason on its own anymore; it read as filler, not a story.)

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

  // 8) Break points: only present for matches sourced from getTournamentDraws
  // (see mapRawDrawsMatch in lib/rapidapi.ts) — undefined/null for anything
  // from getTournamentResults, so this factor just contributes 0 for those,
  // it never breaks. More break-point chances means more return-game
  // tension; capped so one wild service game can't dominate the score.
  // "Saved" break points (chances the server fought off) get their own
  // smaller bonus — that's a different, "clutch" kind of drama.
  if (match.breakPoints) {
    const { totalFaced, totalSaved } = match.breakPoints;
    if (totalFaced > 0) {
      score += Math.min(totalFaced * 1.5, 20);
      if (totalFaced >= 10) {
        reasons.push(`${totalFaced} break points across the match`);
      }
    }
    if (totalSaved >= 8) {
      score += 10;
      reasons.push(`${totalSaved} break points saved`);
    }
  }

  // 9) Transparency, not a penalty: a retirement means the match didn't play
  // to its natural end, so say so rather than presenting it as a clean result.
  if (match.resultType === "retired") {
    reasons.push("Ended in retirement");
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

/**
 * Turns the raw drama score into a human-friendly 1.0-9.9 rating. Never
 * shows a flat 10.0 — reads more like a real curator's call than a
 * suspiciously perfect score.
 *
 * Retuned as a logistic (S-curve) instead of a flat linear divisor. The
 * linear version (score / 10, capped at 9.9) was calibrated before break
 * points were wired in — once those could add up to +30, a genuinely great
 * match easily cleared the old cap and everything great looked identical
 * (real Wimbledon test data: 4 of the top 5 matches all showed "9.9/10",
 * with no separation between a very good match and an all-time classic).
 *
 * The curve below maps a raw score of ~55 to a 5.0 rating (midpoint) and
 * spreads out around it — a below-average match scores meaningfully lower,
 * a great one climbs toward 9.9 gradually instead of slamming into it.
 * Hand-checked against the real Wimbledon top-5 (estimated raw scores
 * roughly 126-171): now spreads ~9.5-9.9 instead of repeating "9.9" four
 * times. Both knobs are pure taste — nudge `midpoint` up/down to shift
 * where "average" sits, `steepness` up to spread scores out more, down to
 * compress them — retune again once more real tournament days are in.
 */
function ratingOutOf10(score: number): number {
  const midpoint = 55; // raw drama score that maps to a 5.0 rating
  const steepness = 25; // higher = gentler slope = more spread at the top end
  const raw = 10 / (1 + Math.exp(-(score - midpoint) / steepness));
  return Math.max(1, Math.min(9.9, Math.round(raw * 10) / 10));
}

/**
 * One-word/short-phrase label shown next to the rating. Rank #1 is always
 * "Match of the Day"; a match with a recorded Hot Shot (see lib/types.ts —
 * hand-curated, see README) gets called out as such; everything else is
 * just "Drama". Tune this rule freely — it's independent of scoring.
 */
function assignTag(rank: number, match: Match): string {
  if (rank === 1) return "Match of the Day";
  if (match.hotShot) return "Hot Shots";
  return "Drama";
}

export function rankMatches(matches: Match[], topN = 5): RankedMatch[] {
  const scored = matches.map((m) => {
    const { score, reasons } = scoreMatch(m);
    return { match: m, score, reasons };
  });

  // Sorted purely by drama score. No player-seed tie-break: match quality
  // decides, full stop — an upset already shows up here on its own merits
  // (upsets are almost always close, tense matches, which this score
  // already rewards), never because of who was seeded where.
  scored.sort((x, y) => y.score - x.score);

  const top = scored.slice(0, topN);
  const withPacing = attachWatchPacing(top);

  return withPacing.map((entry, i) => {
    const rank = i + 1;
    return {
      ...entry.match,
      dramaScore: entry.score,
      dramaReasons: entry.reasons,
      rank,
      rating: ratingOutOf10(entry.score),
      tag: assignTag(rank, entry.match),
      suggestedStart: entry.suggestedStart,
      estimatedMinutes: entry.estimatedMinutes,
    };
  });
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

/**
 * Formats an estimated watch length (see estimateMinutes above — derived
 * from format/tiebreak count, never a real recorded duration) as "H:MMm",
 * e.g. 105 -> "1:45m". Used in the caption/graphic instead of a clock time
 * so it reads as "budget this much time for it," not "it happened at X" —
 * still no real times, same spoiler-safe rule as before, just restyled.
 */
export function formatWatchTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}m`;
}
