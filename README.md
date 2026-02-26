# Pickleball Matchmaker (Simplified v1)

A simple web app for one pickleball group page:

- Save players and ratings
- Mark who is present
- Switch between day/night mode
- Recommend one next match
- Submit score and instantly get the next recommendation
- Show per-player rating change after each submitted match
- Prefer new partner combinations by penalizing repeated recent partners
- One shared Group PIN for editing/scoring

## Stack

- Next.js (App Router + API routes)
- TypeScript
- Postgres (Supabase compatible)

## Environment

Create `/Users/seanglickman/Documents/codex test/.env.local`:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=replace-with-a-long-random-secret
MATCHMAKER_DEBUG=0
```

Set `MATCHMAKER_DEBUG=1` to print recommendation/submit decision logs in the server console.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run migrations:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_add_rating_deltas.sql`
   - `supabase/migrations/003_add_pre_match_ratings.sql`

If you already created tables from an earlier build, run the latest missing migrations.

3. Start app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000), create a group, then open `/g/{slug}`.
   The slug is auto-generated from group name.

## API (minimal)

- `POST /api/group` create group
- `GET /api/group/{slug}` get group + roster + history
- `POST /api/group/{slug}/unlock` exchange PIN for editor token
- `POST /api/group/{slug}/players` add player / set presence / update player
- `POST /api/group/{slug}/recommend` get next match recommendation
- `POST /api/group/{slug}/submit_score` save score, update sit stats, and return next recommendation
- `POST /api/group/{slug}/edit_score` edit a saved match score and recompute match deltas

## Matchmaking

- Present players only
- Prioritize by `games_since_played desc`, then `games_played asc`
- Candidate pool `K = min(6, presentCount)`
- In 6-player mode:
  - previous-round sitters are hard-locked into the next match (no consecutive sits)
  - choose from all valid 4-player team splits and prefer true round-robin rotation
    (minimize repeated partner pairs first, then repeated opponents, then balance)
- Score all 4-player combos from K:
  - reward sit priority
  - penalize games played
  - penalize team imbalance
  - penalize repeated partner pairs from recent matches
- For chosen 4 players, test all 3 team splits and pick smallest rating difference

## Tests

```bash
npm test
```

## Rating Updates

After each submitted score:

- Winners gain rating, losers drop rating.
- Rating change scales by:
  - expected outcome from team rating gap
  - score margin (larger margin = larger move)
- Match row stores `rating_deltas` so history shows who went up/down.
