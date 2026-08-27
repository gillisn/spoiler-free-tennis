import { getLatestDigest } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default async function HomePage() {
  let digest = null;
  let loadError: string | null = null;

  try {
    digest = await getLatestDigest();
  } catch (err: any) {
    loadError = err.message;
  }

  return (
    <main className="wrap">
      <div className="site-title">Spoiler Free Tennis</div>
      <div className="tagline">The best matches from the last 24 hours. No scores. No times.</div>

      {loadError && (
        <div className="empty">
          Couldn&rsquo;t load today&rsquo;s picks right now. ({loadError})
        </div>
      )}

      {!loadError && !digest && (
        <div className="empty">
          Nothing posted yet — check back after the next match day wraps up.
        </div>
      )}

      {digest && (
        <>
          <div className="digest-header">
            <h1>{digest.tournament} — Top 5 To Watch</h1>
            <div className="date">Matches completed {formatDate(digest.digestDate)}</div>
          </div>

          {digest.matches.map((m) => (
            <div className="match" key={m.id}>
              <div className="rank">{m.rank}</div>
              <div className="body">
                <h2>
                  {m.playerA} vs. {m.playerB}
                </h2>
                <div className="badges">
                  <span className="rating">★ {m.rating.toFixed(1)}/10</span>
                  <span className="tag">{m.tag}</span>
                </div>
                {m.dramaReasons.length > 0 && (
                  <p className="reasons">{m.dramaReasons.join(" · ")}</p>
                )}
                <div className="meta">
                  {m.tour === "ATP" ? "Men's" : "Women's"} singles · {m.round}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <footer>
        Ranked by how the match played out — distance, tiebreaks, and comebacks. Player
        seeding is never part of the ranking. No result is ever shown here.
      </footer>
    </main>
  );
}
