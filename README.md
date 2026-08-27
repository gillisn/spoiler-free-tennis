# Spoiler Free Tennis

Every day, this pulls the previous 24 hours of Grand Slam results, ranks the
5 most dramatic matches (not the biggest names — the best matches), and
posts them to spoilerfreetennis.com and Instagram with **no scores and no
times**. Just what to watch and, since there's more good tennis than time to
watch it, a suggested viewing order.

This trial is scoped to the **US Open**.

---

## How it works

```
Vercel Cron (once/day)
  -> /api/cron/daily
     -> lib/rapidapi.ts     pulls yesterday's completed matches
     -> lib/ranking.ts      scores + ranks the top 5 ("drama first")
     -> lib/supabase.ts     stores matches + the day's digest
     -> app/api/og/route.tsx  renders the Instagram graphic (JPEG)
     -> lib/instagram.ts    posts the graphic + caption to Instagram
app/page.tsx               the website itself, reads the latest digest
```

Nothing here is templated filler — the caption and the "why it's worth
watching" lines on the site are built directly from what actually happened
in the match (went the distance, tiebreaks, a comeback, etc.), never
generic hype text.

---

## 1. Accounts you'll need

You said you already have:
- **RapidAPI** key, subscribed to [Tennis API - ATP WTA ITF](https://rapidapi.com/jjrm365-kIFr3Nx_odV/api/tennis-api-atp-wta-itf) (Basic plan, 50 requests/day free — plenty, we only need ~2/day)
- **Instagram Business/Creator account** connected to a **Meta Developer app**

You'll additionally need two free accounts (5 minutes each):
- **[Supabase](https://supabase.com)** — free Postgres database
- **[Vercel](https://vercel.com)** — free hosting + the daily cron job

And, when you're ready to go live for real (not required for the trial):
- The **spoilerfreetennis.com** domain itself — you don't own it yet. Buy it
  from any registrar (Namecheap, Cloudflare, Porkbun, etc. — usually
  ~$10-15/year for a .com) and point its DNS at Vercel once deployed (Vercel
  walks you through this under Project -> Settings -> Domains). Until then,
  the trial runs fine on the free `your-project.vercel.app` address.

---

## 2. Tournament ids — confirmed

`lib/rapidapi.ts` is written against a **real, confirmed response shape**
(the `getTournamentResults` endpoint was tested directly in the RapidAPI
dashboard for a past Wimbledon and returned exactly what the code maps),
**and** a confirmed real path, pulled straight from the provider's own docs
(tennisapidoc.matchstat.com/tournaments): `getTournamentResults` lives at
`/tennis/v2/{tour_type}/tournament/results/{season_id}`. An earlier guess
had this path backwards (`results/tournament/{id}`) — fixed.

**ATP: `21349`** — "U.S. Open - New York", dated 2026-08-31, tier "Grand
Slam". **WTA: `16743`**. Both are wired into `supabase/schema.sql`'s seed
row, so running that file in step 3 sets up the real trial data with no
further editing needed.

Two honest gaps versus the original wishlist, confirmed from the real
response we already have — not fixable by better guessing, just not in
this provider's data:
- **No player seeds/rankings** in this endpoint. Ranking still works
  correctly without them — seeding was only ever a tie-breaker, never part
  of the main drama score — but the tie-breaker itself won't do anything
  until seeds are wired in (there's a separate `Get Tournament Seeds`
  endpoint that could be joined in by player id later).
- **No break-point stats.** There's no per-match box-score endpoint
  confirmed yet. The ranking model already captures the same "how tense
  was this" signal a different way — tiebreak count, comebacks, and how
  close the match went to full distance — which is why this isn't a
  blocker, just a gap from the original idea.

Everything downstream (ranking, the website, Instagram) is written against
a clean internal `Match` type in `lib/types.ts`, so either of the two open
items above is isolated to `lib/rapidapi.ts` and won't cascade.

**Where the tournament ids actually live**: `supabase/schema.sql` creates a
`tournaments` table with one seed row (`us-open-2026`, ids left blank).
Once you've confirmed the real ATP and WTA ids, set them there — either
re-run the `insert` at the bottom of `schema.sql` with the real values, or
just edit that row directly in Supabase's **Table Editor** (Table Editor ->
`tournaments` -> edit the `atp_tournament_id` / `wta_tournament_id`
cells). The cron job reads this table on every run, so a fix takes effect
on the *next* run with no redeploy — useful if a wrong id needs correcting
mid-week. If that table is ever empty, it falls back to
`TOURNAMENT_ID_ATP` / `TOURNAMENT_ID_WTA` env vars instead, which is what
the local dry-run script (`npm run run:daily`) uses for quick testing
without touching Supabase at all.

---

## 3. Set up Supabase

1. Create a new project at supabase.com (free tier).
2. Open **SQL Editor** -> New query, paste the contents of
   `supabase/schema.sql`, and run it. This creates three tables:
   `tournaments` (which event/ids the cron pulls from — see the callout in
   section 2 above), `matches`, and `daily_digests`.
3. Go to **Settings -> API** and copy:
   - **Project URL** -> `SUPABASE_URL`
   - **service_role key** (not the anon key) -> `SUPABASE_SERVICE_ROLE_KEY`
     (safe here because every Supabase call in this app runs server-side —
     the cron route and the homepage's server component — never in the browser)

---

## 4. Set up Instagram posting

You said you already have the Instagram Business account + Meta app, so:

1. In your Meta app, make sure it has the `instagram_business_content_publish`
   and `instagram_business_basic` permissions and is connected to your
   Instagram Business account.
2. Generate a long-lived access token for that Instagram user (Meta's Graph
   API Explorer, or your app's token generation flow) -> `IG_ACCESS_TOKEN`.
3. Find your **Instagram Business Account ID** (a numeric ID, not your
   @handle — Graph API Explorer: `GET /me?fields=id` while using that
   token, or `GET /{your-facebook-page-id}?fields=instagram_business_account`)
   -> `IG_BUSINESS_ACCOUNT_ID`.

Long-lived tokens expire (~60 days) and need refreshing — Meta's docs cover
the refresh call; worth automating later, but out of scope for the trial.

Note: Instagram's Graph API only accepts **JPEG** images for posts, which is
why `app/api/og/route.tsx` renders the graphic and converts it to JPEG
before Instagram ever sees it.

---

## 5. Configure and run locally

```bash
npm install
cp .env.example .env.local
# fill in .env.local with the keys from steps 2-4 above

# Sanity-check the ranking algorithm against sample data (no API/DB needed):
npm run rank:test

# Dry-run against the REAL RapidAPI feed — prints the ranked top 5, doesn't
# write to Supabase or post to Instagram. Use this to verify the field
# mapping in lib/rapidapi.ts (see section 2 above):
npm run run:daily -- 2026-08-25

# Run the site locally:
npm run dev   # -> http://localhost:3000
```

`npm run rank:test` uses `fixtures/sample-matches.json` — five made-up
matches designed to exercise every scoring rule (full-distance five-setter
with three tiebreaks and a two-sets-down comeback, a straight-sets rout, a
three-tiebreak women's match, etc.) so you can see the ranking logic work
without needing live data or credentials.

---

## 6. Deploy to Vercel

1. Push this project to a GitHub repo, then **Import** it in Vercel
   (New Project -> pick the repo). Framework preset: Next.js (auto-detected).
2. Add every variable from `.env.local` to the Vercel project's
   **Settings -> Environment Variables** (all environments).
3. Set `NEXT_PUBLIC_SITE_URL` to your actual deployed URL (e.g.
   `https://spoiler-free-tennis.vercel.app`, or `https://spoilerfreetennis.com`
   once the domain is connected) — Instagram needs this to fetch the
   generated image.
4. Deploy. Vercel reads `vercel.json` automatically and schedules
   `/api/cron/daily` to run once a day at **12:00 UTC** (adjust the cron
   expression in `vercel.json` if you want it earlier/later — US Open night
   matches usually wrap by ~5-7 AM UTC, so 12:00 UTC leaves a safe buffer).
   Vercel's free (Hobby) tier supports one cron run per day, which is all
   this needs.
5. Trigger it manually once to test, since waiting for the schedule is
   slow:
   ```bash
   curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://your-deployed-url/api/cron/daily
   ```
   Check the JSON response, then check the site and your Instagram feed.

---

## 7. The ranking rules ("drama first")

Defined in `lib/ranking.ts`. Per your brief:

- **Distance matters most**: how close the match went to the maximum
  possible length (5 sets for men, 3 for women) — up to 40 of the ~100+
  possible points.
- **Tiebreaks** add points per set, with a bonus if the *final* set was a
  breaker.
- **Comebacks** (lost set one but won the match; for men, coming back from
  two sets down) add significant points.
- **A tight final set** and an on-record **Hot Shot** (see below) each add
  a smaller bonus.
- **Seeding/ranking is not part of the score.** It only breaks near-ties —
  two matches within 5 drama points of each other get reordered by player
  prominence; anything further apart is decided by drama alone. That's the
  "drama first" behavior you picked.

All of this is one function (`scoreMatch`) with plain, commented point
values — tune any number directly if the mix feels off after watching it
run for a few days.

**On Hot Shots**: confirmed not present in this provider's data (see
section 2). `hotShot` in `lib/types.ts` is still there, wired into
scoring and the caption, but will always be empty unless hand-curated —
after the daily cron runs, edit the `hot_shot` column for a match directly
in Supabase's Table Editor, then re-trigger the cron (or just accept the
site/post already went out without it that day).

**On break points**: also confirmed not present (section 2). Not wired
into scoring at all — tiebreak count and comebacks are doing that job
instead.

---

## 8. What's genuinely a trial vs. production-ready

- **Ranking, site, DB schema, Instagram posting flow**: solid, tested logic
  (see `npm run rank:test`), ready to run as-is.
- **RapidAPI integration**: built against a real confirmed response shape
  and path, and both 2026 US Open ids are confirmed and wired in (section
  2). Worth one `npm run run:daily -- 2026-08-25` dry-run against live data
  before trusting the cron unattended, just to see real matches flow
  through end to end — the ids being right doesn't guarantee the *results*
  endpoint has data for every date yet (early rounds, qualifying, etc.).
- **Domain**: not purchased — trial runs on a free Vercel subdomain until
  you buy and connect spoilerfreetennis.com.
- **Token refresh**: the Instagram long-lived token isn't auto-refreshed;
  fine for a short trial, needs revisiting for anything longer-running.
- **Tournament scope**: controlled by `TOURNAMENT_ID_ATP` /
  `TOURNAMENT_ID_WTA` / `TOURNAMENT_LABEL` env vars — change those to run
  this for other events later (each event needs its own ids from this
  provider).
- **Seeds and break points**: not returned by this provider (section 2) —
  ranking works fine without them, but the seed tie-breaker is currently a
  no-op and break points aren't factored in at all.
