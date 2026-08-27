// Local dry run against the REAL RapidAPI feed — no Supabase writes, no
// Instagram post. Use this to check lib/rapidapi.ts's field mapping is
// correct (see README section 2) before trusting the live cron.
//
// Run with: npm run run:daily -- 2026-08-25
// (date defaults to yesterday if omitted)
//
// Run with: npm run run:daily -- all
// to skip the date filter entirely and rank every completed match the
// tournament id(s) return — handy for testing against an already-finished
// event (e.g. a past Wimbledon id) where you don't know the exact date of
// any one match. Combine with TOURNAMENT_ID_ATP/WTA in .env.local pointed
// at that tournament.
//
// Set USE_DRAWS=1 (plus TOURNAMENT_NAME_ATP / TOURNAMENT_NAME_WTA /
// TOURNAMENT_YEAR in .env.local) to test the Draws-based path instead —
// see lib/rapidapi.ts's getCompletedMatchesForDateViaDraws. This is the one
// with break points, but isn't yet what the live cron uses (README section
// 7) — this is how you'd confirm the exact tournament name string works
// before flipping that switch.
import "dotenv/config";
import { getCompletedMatchesForDate, getCompletedMatchesForDateViaDraws } from "../lib/rapidapi";
import { rankMatches } from "../lib/ranking";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const arg = process.argv[2];
  const targetDate = arg === "all" ? null : arg || yesterday();
  const tournamentLabel = process.env.TOURNAMENT_LABEL || "US Open";
  const useDraws = process.env.USE_DRAWS === "1";

  console.log(
    targetDate === null
      ? `Fetching ALL completed matches for ${tournamentLabel} (no date filter)...`
      : `Fetching completed matches for ${tournamentLabel} on ${targetDate}...`
  );

  let matches;
  if (useDraws) {
    const year = Number(process.env.TOURNAMENT_YEAR || new Date().getFullYear());
    const nameAtp = process.env.TOURNAMENT_NAME_ATP;
    const nameWta = process.env.TOURNAMENT_NAME_WTA;
    console.log(`(via getTournamentDraws, name+year lookup, year=${year} — this script doesn't touch Supabase)\n`);
    const lookups = [
      nameAtp ? { tour: "atp" as const, tournamentName: nameAtp, year, tournamentLabel } : null,
      nameWta ? { tour: "wta" as const, tournamentName: nameWta, year, tournamentLabel } : null,
    ].filter((l): l is NonNullable<typeof l> => l !== null);
    if (lookups.length === 0) {
      console.log("Set TOURNAMENT_NAME_ATP and/or TOURNAMENT_NAME_WTA in .env.local to use USE_DRAWS=1.");
      return;
    }
    matches = await getCompletedMatchesForDateViaDraws(targetDate, lookups);
  } else {
    console.log("(using TOURNAMENT_ID_ATP / TOURNAMENT_ID_WTA from .env.local — this script doesn't touch Supabase)\n");
    matches = await getCompletedMatchesForDate(targetDate, { tournamentLabel });
  }

  console.log(`Found ${matches.length} completed match(es).`);
  if (matches.length === 0) {
    console.log(
      "\nNothing came back. Either there really were no matches (yet), or the\n" +
        "endpoint path / field mapping in lib/rapidapi.ts needs adjusting — see\n" +
        "README section 2. Try logging the raw API response directly to check."
    );
    return;
  }

  const ranked = rankMatches(matches, 5);
  console.log(`\nTop ${ranked.length} by drama score:\n`);
  ranked.forEach((m) => {
    console.log(`${m.rank}. ${m.playerA} vs. ${m.playerB}  ──  ⭐ ${m.rating.toFixed(1)}/10  ──  🏷 ${m.tag}  (completed ${m.completedDate})`);
    m.dramaReasons.forEach((r) => console.log(`     - ${r}`));
  });
}

main().catch((err) => {
  console.error("Dry run failed:", err.message);
  process.exit(1);
});
