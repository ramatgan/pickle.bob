import { sql } from "@/lib/db";
import {
  HARD_NO_REPEAT_WINDOW,
  recommendNextMatch,
  validateSubmittedSixPlayerMatchup
} from "@/lib/matchmaker";
import { buildRatingEditAdjustments, calculateDoublesRatingUpdate } from "@/lib/rating";
import type { Group, GroupWithPin, Match, Player, Recommendation } from "@/lib/types";

export async function createGroup({
  name,
  slug,
  pinHash
}: {
  name: string;
  slug: string;
  pinHash: string;
}) {
  const rows = await sql<Group[]>`
    insert into groups (name, slug, pin_hash)
    values (${name}, ${slug}, ${pinHash})
    returning id, name, slug
  `;

  return rows[0];
}

export async function getGroupBySlug(slug: string) {
  const rows = await sql<Group[]>`
    select id, name, slug
    from groups
    where slug = ${slug}
    limit 1
  `;

  return rows[0] ?? null;
}

export async function getGroupWithPinBySlug(slug: string) {
  const rows = await sql<GroupWithPin[]>`
    select id, name, slug, pin_hash
    from groups
    where slug = ${slug}
    limit 1
  `;

  return rows[0] ?? null;
}

export async function listPlayers(groupId: string) {
  const rows = await sql<Player[]>`
    select
      id,
      group_id,
      name,
      rating::float8 as rating,
      is_present,
      games_since_played,
      games_played
    from players
    where group_id = ${groupId}
    order by name asc
  `;

  return rows;
}

export async function addPlayer({
  groupId,
  name,
  rating
}: {
  groupId: string;
  name: string;
  rating: number;
}) {
  const rows = await sql<Player[]>`
    insert into players (group_id, name, rating, is_present)
    values (${groupId}, ${name}, ${rating}, true)
    returning
      id,
      group_id,
      name,
      rating::float8 as rating,
      is_present,
      games_since_played,
      games_played
  `;

  return rows[0];
}

export async function updatePlayer({
  groupId,
  playerId,
  name,
  rating
}: {
  groupId: string;
  playerId: string;
  name?: string;
  rating?: number;
}) {
  const rows = await sql<Player[]>`
    update players
    set
      name = coalesce(${name ?? null}, name),
      rating = coalesce(${rating ?? null}, rating)
    where id = ${playerId}
      and group_id = ${groupId}
    returning
      id,
      group_id,
      name,
      rating::float8 as rating,
      is_present,
      games_since_played,
      games_played
  `;

  return rows[0] ?? null;
}

export async function setPresence({
  groupId,
  updates
}: {
  groupId: string;
  updates: Array<{ playerId: string; isPresent: boolean }>;
}) {
  if (updates.length === 0) {
    return;
  }

  await sql.begin(async (tx) => {
    for (const update of updates) {
      await tx.unsafe(
        `
          update players
          set
            is_present = $1,
            games_since_played = case when $1 = true then 0 else games_since_played end
          where id = $2
            and group_id = $3
        `,
        [update.isPresent, update.playerId, groupId]
      );
    }
  });
}

export async function listMatches(groupId: string, limit = 100) {
  const rows = await sql<Match[]>`
    select
      id,
      group_id,
      created_at,
      players,
      team_a,
      team_b,
      score_a,
      score_b,
      coalesce(rating_deltas, '{}'::jsonb) as rating_deltas,
      coalesce(pre_match_ratings, '{}'::jsonb) as pre_match_ratings
    from matches
    where group_id = ${groupId}
    order by created_at desc, id desc
    limit ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    rating_deltas: normalizeRatingMap((row as { rating_deltas?: unknown }).rating_deltas),
    pre_match_ratings: normalizeRatingMap((row as { pre_match_ratings?: unknown }).pre_match_ratings)
  }));
}

export async function listRecentMatches(groupId: string, limit = 12) {
  const rows = await sql<Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }>>`
    select id, created_at, team_a, team_b
    from matches
    where group_id = ${groupId}
    order by created_at desc, id desc
    limit ${limit}
  `;

  return rows;
}

export async function getPresentPlayers(groupId: string) {
  const rows = await sql<Player[]>`
    select
      id,
      group_id,
      name,
      rating::float8 as rating,
      is_present,
      games_since_played,
      games_played
    from players
    where group_id = ${groupId}
      and is_present = true
    order by games_since_played desc, games_played asc, id asc
  `;

  return rows;
}

export async function saveMatchAndUpdateState({
  groupId,
  playerIds,
  teamA,
  teamB,
  scoreA,
  scoreB
}: {
  groupId: string;
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
}) {
  return sql.begin(async (tx) => {
    await tx.unsafe(
      `
        select id
        from groups
        where id = $1
        for update
      `,
      [groupId]
    );

    const lockedPresentPlayers = await tx.unsafe<Player[]>(
      `
        select
          id,
          group_id,
          name,
          rating::float8 as rating,
          is_present,
          games_since_played,
          games_played
        from players
        where group_id = $1
          and is_present = true
        order by games_since_played desc, games_played asc, id asc
      `,
      [groupId]
    );

    const recentMatches = await tx.unsafe<Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }>>(
      `
        select id, created_at, team_a, team_b
        from matches
        where group_id = $1
        order by created_at desc, id desc
        limit $2
      `,
      [groupId, 12]
    );

    const sixPlayerValidation = validateSubmittedSixPlayerMatchup(lockedPresentPlayers, recentMatches, {
      playerIds,
      teamA,
      teamB
    });
    if (!sixPlayerValidation.ok) {
      throw new Error(sixPlayerValidation.reason);
    }

    const submittedMatchKey = teamsKey(teamA, teamB);
    const isSubmittedRepeat = recentMatches
      .slice(0, HARD_NO_REPEAT_WINDOW)
      .some((match) => teamsKey(match.team_a, match.team_b) === submittedMatchKey);
    if (isSubmittedRepeat && lockedPresentPlayers.length >= 4 && lockedPresentPlayers.length !== 6) {
      throw new Error(
        `Matchup was used in the last ${HARD_NO_REPEAT_WINDOW} games. Use a different matchup.`
      );
    }

    const presenceRows = await tx.unsafe<Array<{ id: string; rating: number }>>(
      `
        select id, rating::float8 as rating
        from players
        where group_id = $1
          and is_present = true
          and id = any($2::uuid[])
      `,
      [groupId, playerIds]
    );

    if (presenceRows.length !== 4) {
      throw new Error("Submitted players must be present in group");
    }

    const ratingsById = Object.fromEntries(
      presenceRows.map((row) => [row.id, Number(row.rating)])
    );

    const ratingUpdate = calculateDoublesRatingUpdate({
      ratingsById,
      teamA,
      teamB,
      scoreA,
      scoreB
    });

    // Get the most recent session for this group, or create one if none exists.
    // The matches table requires a non-null session_id (added in migration 004).
    const sessionRows = await tx.unsafe<Array<{ id: string }>>(
      `
        select id from sessions
        where group_id = $1
        order by started_at desc, id desc
        limit 1
      `,
      [groupId]
    );

    let sessionId: string;
    if (sessionRows.length > 0) {
      sessionId = sessionRows[0].id;
    } else {
      const newSession = await tx.unsafe<Array<{ id: string }>>(
        `insert into sessions (group_id) values ($1) returning id`,
        [groupId]
      );
      sessionId = newSession[0].id;
    }

    const matchRows = await tx.unsafe<Match[]>(
      `
        insert into matches (
          group_id,
          session_id,
          players,
          team_a,
          team_b,
          score_a,
          score_b,
          rating_deltas,
          pre_match_ratings
        )
        values ($1, $2::uuid, $3::uuid[], $4::uuid[], $5::uuid[], $6, $7, $8::jsonb, $9::jsonb)
        returning
          id,
          group_id,
          created_at,
          players,
          team_a,
          team_b,
          score_a,
          score_b,
          coalesce(rating_deltas, '{}'::jsonb) as rating_deltas,
          coalesce(pre_match_ratings, '{}'::jsonb) as pre_match_ratings
      `,
      [
        groupId,
        sessionId,
        playerIds,
        teamA,
        teamB,
        scoreA,
        scoreB,
        JSON.stringify(ratingUpdate.deltasById),
        JSON.stringify(ratingsById)
      ]
    );

    const match = matchRows[0];

    for (const playerId of playerIds) {
      const nextRating = ratingUpdate.newRatingsById[playerId];

      await tx.unsafe(
        `
          update players
          set
            rating = $1,
            games_played = games_played + 1,
            games_since_played = 0
          where group_id = $2
            and id = $3
        `,
        [nextRating, groupId, playerId]
      );
    }

    await tx.unsafe(
      `
        update players
        set games_since_played = games_since_played + 1
        where group_id = $1
          and is_present = true
          and id <> all($2::uuid[])
      `,
      [groupId, playerIds]
    );

    const postSubmitPresentPlayers = await tx.unsafe<Player[]>(
      `
        select
          id,
          group_id,
          name,
          rating::float8 as rating,
          is_present,
          games_since_played,
          games_played
        from players
        where group_id = $1
          and is_present = true
        order by games_since_played desc, games_played asc, id asc
      `,
      [groupId]
    );

    let nextRecommendation: Recommendation | null = null;
    if (postSubmitPresentPlayers.length >= 4) {
      try {
        const postSubmitRecentMatches = await tx.unsafe<
          Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }>
        >(
          `
            select id, created_at, team_a, team_b
            from matches
            where group_id = $1
            order by created_at desc, id desc
            limit 12
          `,
          [groupId]
        );

        // Guard against Supabase PgBouncer read-lag: each transaction may land on a
        // different pooled connection that hasn't yet received commits made by the
        // previous request. Build the most complete recent-match list by merging:
        //   1. The match just inserted (always correct — it's in this transaction)
        //   2. The post-insert DB read (may include more history than the pre-insert read)
        //   3. The pre-insert recentMatches snapshot (may include matches the post-insert
        //      read missed, because READ COMMITTED sees data committed before each statement)
        const currentMatchSummary = {
          id: match.id as string,
          created_at: typeof match.created_at === "string"
            ? match.created_at
            : (match.created_at as unknown as Date).toISOString(),
          team_a: match.team_a as string[],
          team_b: match.team_b as string[]
        };

        const mergedRecentMatches = mergeRecentMatchesById([
          currentMatchSummary,
          ...postSubmitRecentMatches,
          ...recentMatches
        ]).slice(0, 12);

        nextRecommendation = recommendNextMatch(postSubmitPresentPlayers, mergedRecentMatches);
      } catch {
        nextRecommendation = null;
      }
    }

    return {
      match: normalizeMatchRow(match),
      nextRecommendation,
      postSubmitPresentPlayers
    };
  });
}

export async function editMatchScore({
  groupId,
  matchId,
  scoreA,
  scoreB
}: {
  groupId: string;
  matchId: string;
  scoreA: number;
  scoreB: number;
}) {
  return sql.begin(async (tx) => {
    const rows = await tx.unsafe<Match[]>(
      `
        select
          id,
          group_id,
          created_at,
          players,
          team_a,
          team_b,
          score_a,
          score_b,
          coalesce(rating_deltas, '{}'::jsonb) as rating_deltas,
          coalesce(pre_match_ratings, '{}'::jsonb) as pre_match_ratings
        from matches
        where id = $1
          and group_id = $2
        limit 1
      `,
      [matchId, groupId]
    );

    const current = rows[0];
    if (!current) {
      throw new Error("Match not found");
    }

    const oldDeltas = normalizeRatingMap((current as { rating_deltas?: unknown }).rating_deltas);
    const preMatchRatings = normalizeRatingMap(
      (current as { pre_match_ratings?: unknown }).pre_match_ratings
    );

    const hasAllPreRatings = current.players.every((id) => Number.isFinite(preMatchRatings[id]));
    if (!hasAllPreRatings) {
      throw new Error("This match cannot be edited because pre-match rating snapshot is missing");
    }

    const ratingUpdate = calculateDoublesRatingUpdate({
      ratingsById: preMatchRatings,
      teamA: current.team_a,
      teamB: current.team_b,
      scoreA,
      scoreB
    });

    const newDeltas = ratingUpdate.deltasById;

    await tx.unsafe(
      `
        update matches
        set score_a = $1, score_b = $2, rating_deltas = $3::jsonb
        where id = $4
          and group_id = $5
      `,
      [scoreA, scoreB, JSON.stringify(newDeltas), matchId, groupId]
    );

    const adjustments = buildRatingEditAdjustments({
      playerIds: current.players,
      oldDeltas,
      newDeltas
    });

    for (const adjustment of adjustments) {
      await tx.unsafe(
        `
          update players
          set rating = rating + $1
          where id = $2
            and group_id = $3
        `,
        [adjustment.delta, adjustment.playerId, groupId]
      );
    }

    const updatedRows = await tx.unsafe<Match[]>(
      `
        select
          id,
          group_id,
          created_at,
          players,
          team_a,
          team_b,
          score_a,
          score_b,
          coalesce(rating_deltas, '{}'::jsonb) as rating_deltas,
          coalesce(pre_match_ratings, '{}'::jsonb) as pre_match_ratings
        from matches
        where id = $1
          and group_id = $2
        limit 1
      `,
      [matchId, groupId]
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new Error("Match update failed");
    }

    return {
      ...updated,
      rating_deltas: normalizeRatingMap((updated as { rating_deltas?: unknown }).rating_deltas),
      pre_match_ratings: normalizeRatingMap(
        (updated as { pre_match_ratings?: unknown }).pre_match_ratings
      )
    };
  });
}

function normalizeRatingMap(value: unknown): Record<string, number> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const parsed: Record<string, number> = {};

  for (const [key, delta] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(delta);
    if (Number.isFinite(numeric)) {
      parsed[key] = numeric;
    }
  }

  return parsed;
}

function normalizeMatchRow(match: Match): Match {
  return {
    ...match,
    rating_deltas: normalizeRatingMap((match as { rating_deltas?: unknown }).rating_deltas),
    pre_match_ratings: normalizeRatingMap((match as { pre_match_ratings?: unknown }).pre_match_ratings)
  };
}

function mergeRecentMatchesById(
  matches: Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }>
) {
  const byId = new Map<string, (typeof matches)[0]>();
  for (const m of matches) {
    if (typeof m.id === "string" && !byId.has(m.id)) {
      byId.set(m.id, m);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(String(a.created_at));
    const bTime = Date.parse(String(b.created_at));
    if (aTime !== bTime) return bTime - aTime;
    return b.id.localeCompare(a.id);
  });
}

function teamsKey(teamA: string[], teamB: string[]) {
  const left = pairKey(teamA[0], teamA[1]);
  const right = pairKey(teamB[0], teamB[1]);
  return [left, right].sort().join("|");
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}
