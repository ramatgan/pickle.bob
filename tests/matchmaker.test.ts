import test from "node:test";
import assert from "node:assert/strict";
import {
  HARD_NO_REPEAT_WINDOW,
  recommendNextMatch,
  validateSubmittedSixPlayerMatchup
} from "../lib/matchmaker";
import type { Player } from "../lib/types";

function player(id: string): Player {
  return {
    id,
    group_id: "g1",
    name: id.toUpperCase(),
    rating: 3.5,
    is_present: true,
    games_since_played: 0,
    games_played: 0
  };
}

test("6-player mode prevents consecutive sits by forcing previous sitters to play", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches = [
    {
      team_a: ["a", "b"],
      team_b: ["c", "d"]
    }
  ];

  const recommendation = recommendNextMatch(presentPlayers, recentMatches);

  assert.equal(recommendation.playerIds.length, 4);
  assert.ok(recommendation.playerIds.includes("e"));
  assert.ok(recommendation.playerIds.includes("f"));
});

test("6-player rotation keeps sit counts balanced over five matches", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches: Array<{ team_a: string[]; team_b: string[] }> = [];
  const sitsById: Record<string, number> = {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0
  };

  for (let i = 0; i < 5; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const playingIds = new Set(recommendation.playerIds);

    for (const participant of presentPlayers) {
      if (playingIds.has(participant.id)) {
        participant.games_played += 1;
        participant.games_since_played = 0;
      } else {
        participant.games_since_played += 1;
        sitsById[participant.id] += 1;
      }
    }

    recentMatches.unshift({
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });
  }

  const sitCounts = Object.values(sitsById);
  const maxSits = Math.max(...sitCounts);
  const minSits = Math.min(...sitCounts);

  assert.ok(maxSits <= 2);
  assert.ok(maxSits - minSits <= 1);
});

test("6-player mode avoids immediate exact team rematch across rounds", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches: Array<{ team_a: string[]; team_b: string[] }> = [];
  let previousKey: string | null = null;

  for (let i = 0; i < 9; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const key = teamsKey(recommendation.teamA, recommendation.teamB);

    if (previousKey) {
      assert.notEqual(key, previousKey);
    }

    previousKey = key;

    const playingIds = new Set(recommendation.playerIds);
    for (const participant of presentPlayers) {
      if (playingIds.has(participant.id)) {
        participant.games_played += 1;
        participant.games_since_played = 0;
      } else {
        participant.games_since_played += 1;
      }
    }

    recentMatches.unshift({
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });
  }
});

test("6-player mode rotates partner pairs as round robin over 15 matches", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches: Array<{ team_a: string[]; team_b: string[] }> = [];
  const partnerCounts = new Map<string, number>();

  for (let i = 0; i < 15; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const teamAKey = pairKey(recommendation.teamA[0], recommendation.teamA[1]);
    const teamBKey = pairKey(recommendation.teamB[0], recommendation.teamB[1]);

    partnerCounts.set(teamAKey, (partnerCounts.get(teamAKey) ?? 0) + 1);
    partnerCounts.set(teamBKey, (partnerCounts.get(teamBKey) ?? 0) + 1);

    const playingIds = new Set(recommendation.playerIds);
    for (const participant of presentPlayers) {
      if (playingIds.has(participant.id)) {
        participant.games_played += 1;
        participant.games_since_played = 0;
      } else {
        participant.games_since_played += 1;
      }
    }

    recentMatches.unshift({
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });
  }

  assert.equal(partnerCounts.size, 15);
  for (const count of partnerCounts.values()) {
    assert.equal(count, 2);
  }
});

test("6-player mode prevents any player from sitting 3 of the last 5 rounds", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  presentPlayers[0].rating = 3.1;
  presentPlayers[1].rating = 3.2;
  presentPlayers[2].rating = 3.4;
  presentPlayers[3].rating = 3.6;
  presentPlayers[4].rating = 3.8;
  presentPlayers[5].rating = 3.9;

  const recentMatches: Array<{ team_a: string[]; team_b: string[] }> = [];
  const sitHistory = new Map<string, number[]>();
  for (const participant of presentPlayers) {
    sitHistory.set(participant.id, []);
  }

  for (let round = 0; round < 20; round += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const playingIds = new Set(recommendation.playerIds);

    for (const participant of presentPlayers) {
      const didSit = playingIds.has(participant.id) ? 0 : 1;
      const history = sitHistory.get(participant.id);
      if (!history) {
        throw new Error("Missing sit history");
      }
      history.push(didSit);

      if (playingIds.has(participant.id)) {
        participant.games_played += 1;
        participant.games_since_played = 0;
      } else {
        participant.games_since_played += 1;
      }
    }

    recentMatches.unshift({
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });

    for (const participant of presentPlayers) {
      const history = sitHistory.get(participant.id);
      if (!history || history.length < 5) {
        continue;
      }

      const lastFiveSits = history.slice(-5).reduce((sum, value) => sum + value, 0);
      assert.ok(
        lastFiveSits >= 1,
        `player ${participant.id} played 5 straight games at round ${round + 1}`
      );
      assert.ok(
        lastFiveSits <= 2,
        `player ${participant.id} sat ${lastFiveSits} times in last 5 rounds at round ${round + 1}`
      );
    }
  }
});

test("6-player recommendations are deterministic across equivalent player ordering", () => {
  const basePlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  basePlayers[0].games_since_played = 1;
  basePlayers[1].games_since_played = 1;
  basePlayers[2].games_played = 1;
  basePlayers[3].games_played = 1;
  basePlayers[4].games_played = 2;
  basePlayers[5].games_played = 2;

  const recentMatches: Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }> = [
    {
      id: "m2",
      created_at: "2026-02-24T04:37:41.748Z",
      team_a: ["c", "d"],
      team_b: ["e", "f"]
    },
    {
      id: "m1",
      created_at: "2026-02-24T04:37:37.883Z",
      team_a: ["b", "f"],
      team_b: ["a", "e"]
    }
  ];

  const expected = recommendNextMatch(basePlayers, recentMatches);
  const expectedPlayers = [...expected.playerIds].sort().join(",");
  const expectedKey = teamsKey(expected.teamA, expected.teamB);

  const reordered = [basePlayers[4], basePlayers[2], basePlayers[0], basePlayers[5], basePlayers[1], basePlayers[3]];
  const actual = recommendNextMatch(reordered, recentMatches);

  assert.equal([...actual.playerIds].sort().join(","), expectedPlayers);
  assert.equal(teamsKey(actual.teamA, actual.teamB), expectedKey);
});

test("6-player mode avoids exact matchup repeats inside hard no-repeat window", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches: Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }> = [];
  const recentKeys: string[] = [];

  for (let i = 0; i < 20; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const key = teamsKey(recommendation.teamA, recommendation.teamB);

    assert.ok(
      !recentKeys.includes(key),
      `repeat matchup ${key} found within window ${HARD_NO_REPEAT_WINDOW} at round ${i + 1}`
    );

    const playingIds = new Set(recommendation.playerIds);
    for (const participant of presentPlayers) {
      if (playingIds.has(participant.id)) {
        participant.games_played += 1;
        participant.games_since_played = 0;
      } else {
        participant.games_since_played += 1;
      }
    }

    recentMatches.unshift({
      id: `m${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });

    recentKeys.unshift(key);
    if (recentKeys.length > HARD_NO_REPEAT_WINDOW) {
      recentKeys.pop();
    }
  }
});

test("6-player submit validation rejects matchup repeats inside hard no-repeat window", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches = [
    {
      team_a: ["c", "e"],
      team_b: ["d", "f"]
    },
    {
      team_a: ["a", "b"],
      team_b: ["c", "d"]
    }
  ];

  const result = validateSubmittedSixPlayerMatchup(presentPlayers, recentMatches, {
    playerIds: ["a", "b", "c", "d"],
    teamA: ["a", "b"],
    teamB: ["c", "d"]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /used in the last/i);
  }
});

test("6-player submit validation allows sit cap edge cases (enforced by recommendation engine, not submit)", () => {
  const presentPlayers = ["a", "b", "c", "d", "e", "f"].map(player);
  const recentMatches = [
    {
      team_a: ["c", "d"],
      team_b: ["e", "f"]
    },
    {
      team_a: ["a", "c"],
      team_b: ["b", "d"]
    },
    {
      team_a: ["a", "d"],
      team_b: ["b", "c"]
    },
    {
      team_a: ["a", "b"],
      team_b: ["e", "f"]
    }
  ];

  const result = validateSubmittedSixPlayerMatchup(presentPlayers, recentMatches, {
    playerIds: ["a", "b", "c", "d"],
    teamA: ["a", "b"],
    teamB: ["c", "d"]
  });

  // Submit validation only rejects repeat-window violations.
  // Sit/play cap fairness is enforced by the recommendation engine, not re-checked here,
  // to avoid false rejections from timing mismatches between recommend and submit.
  assert.equal(result.ok, true);
});

test("4-player mode avoids immediate exact rematch when alternatives exist", () => {
  const presentPlayers = ["a", "b", "c", "d"].map(player);
  const recentMatches = [
    {
      team_a: ["a", "b"],
      team_b: ["c", "d"]
    }
  ];

  const recommendation = recommendNextMatch(presentPlayers, recentMatches);
  const nextKey = teamsKey(recommendation.teamA, recommendation.teamB);
  const previousKey = teamsKey(recentMatches[0].team_a, recentMatches[0].team_b);

  assert.notEqual(nextKey, previousKey);
});

test("4-player mode uses match recency metadata to avoid immediate rematch", () => {
  const presentPlayers = ["a", "b", "c", "d"].map(player);
  const recentMatches: Array<{ id: string; created_at: string; team_a: string[]; team_b: string[] }> = [];
  let previousKey: string | null = null;

  for (let i = 0; i < 10; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const currentKey = teamsKey(recommendation.teamA, recommendation.teamB);
    if (previousKey) {
      assert.notEqual(currentKey, previousKey);
    }

    // Intentionally append in oldest->newest order to ensure matcher sorts by recency metadata.
    recentMatches.push({
      id: `m${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });
    previousKey = currentKey;
  }
});

test("4-player mode rotates through unique team splits before repeating", () => {
  const presentPlayers = ["a", "b", "c", "d"].map(player);
  const recentMatches: Array<{ team_a: string[]; team_b: string[] }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < 3; i += 1) {
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const key = teamsKey(recommendation.teamA, recommendation.teamB);
    seen.add(key);

    recentMatches.unshift({
      team_a: recommendation.teamA,
      team_b: recommendation.teamB
    });
  }

  assert.equal(seen.size, 3);
});

function teamsKey(teamA: string[], teamB: string[]) {
  const left = [teamA[0], teamA[1]].sort().join(":");
  const right = [teamB[0], teamB[1]].sort().join(":");
  return [left, right].sort().join("|");
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}
