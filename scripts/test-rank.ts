// Local sanity check for the ranking algorithm — no API keys or DB needed.
// Run with: npm run rank:test
import fs from "node:fs";
import path from "node:path";
import { rankMatches } from "../lib/ranking";
import { Match } from "../lib/types";

const fixturePath = path.join(__dirname, "..", "fixtures", "sample-matches.json");
const matches: Match[] = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

const ranked = rankMatches(matches, 5);

console.log(`\nRanked ${ranked.length} of ${matches.length} matches:\n`);
ranked.forEach((m) => {
  console.log(
    `${m.rank}. ${m.playerA} vs. ${m.playerB}  ──  ⭐ ${m.rating.toFixed(1)}/10  ──  🏷 ${m.tag}  ──  start ${m.suggestedStart} (~${m.estimatedMinutes} min)`
  );
  m.dramaReasons.forEach((r) => console.log(`     - ${r}`));
});
console.log("");
