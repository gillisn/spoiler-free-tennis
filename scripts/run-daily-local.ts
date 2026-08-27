// Local dry run against the REAL RapidAPI feed — no Supabase writes, no
// Instagram post. Use this to check lib/rapidapi.ts's field mapping is
// correct (see README section 2) before trusting the live cron.
//
// Run with: npm run run:daily -- 2026-08-25
// (date defaults to yesterday if omitted)
import "dotenv/config";
import { getCompletedMatchesForDate } from "../lib/rapidapi";
import { rankMatches } from "../lib/ranking";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const targetDate = process.argv[2] || yesterday();
  const tournamentLabel = process.env.TOURNAMENT_LABEL || "US Open";

  console.log(`Fetching completed matches for ${tournamentLabel} on ${targetDate}...`);
  console.log("(using TOURNAMENT_ID_ATP / TOURNAMENT_ID_WTA from .env.local — this script doesn't touch Supabase)\n");
  const matches = await getCompletedMatchesForDate(targetDate, { tournamentLabel });

  console.log(`Found ${matches.length} completed match(es).`);
  if (matches.length === 0) {
    console.log(
      "\nNothing came back. Either there really were no matches that day, or the\n" +
        "endpoint path / field mapping in lib/rapidapi.ts needs adjusting — see\n" +
        "README section 2. Try logging the raw API response directly to check."
    );
    return;
  }

  const ranked = rankMatches(matches, 5);
  console.log(`\nTop ${ranked.length} by drama score:\n`);
  ranked.forEach((m) => {
    console.log(`${m.rank}. ${m.playerA} vs. ${m.playerB} — score ${m.dramaScore} — start ${m.suggestedStart}`);
    m.dramaReasons.forEach((r) => console.log(`     - ${r}`));
  });
}

main().catch((err) => {
  console.error("Dry run failed:", err.message);
  process.exit(1);
});
