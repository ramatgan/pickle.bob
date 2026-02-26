import type { Player, Recommendation } from "@/lib/types";

export const HARD_NO_REPEAT_WINDOW = 6;
const SIT_WINDOW_SIZE = 5;
const SIT_LOOKBACK = SIT_WINDOW_SIZE - 1;

interface ScoredSet {
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  sitScore: number;
  playPenalty: number;
  balanceDiff: number;
  partnerRepeatPenalty: number;
  total: number;
}

interface TeamOption {
  teamA: string[];
  teamB: string[];
  balanceDiff: number;
  partnerRepeatPenalty: number;
  exactTeamRepeatPenalty: number;
  immediateExactRepeat: boolean;
  recentExactRepeat: boolean;
  lastUsedIndex: number;
  score: number;
  matchupKey: string;
}

interface SixPlayerProposal {
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  sitScore: number;
  playPenalty: number;
  balanceDiff: number;
  partnerRepeatPenalty: number;
  partnerUsageMax: number;
  opponentRepeatPenalty: number;
  opponentUsageMax: number;
  playCountSpreadAfter: number;
  sitWindowMaxAfter: number;
  sitWindowMinAfter: number;
  sitWindowTotalAfter: number;
  violatesFiveMatchSitCap: boolean;
  violatesFiveMatchPlayCap: boolean;
  violatesRepeatWindow: boolean;
  immediateExactRepeat: boolean;
  recentExactRepeat: boolean;
  matchupKey: string;
}

interface RecentMatch {
  id?: string;
  created_at?: string;
  team_a: string[];
  team_b: string[];
}

type SubmittedMatchup = {
  playerIds: string[];
  teamA: string[];
  teamB: string[];
};

export function recommendNextMatch(
  presentPlayers: Player[],
  recentMatches: RecentMatch[] = []
): Recommendation {
  if (presentPlayers.length < 4) {
    throw new Error("At least 4 present players are required");
  }

  const sorted = [...presentPlayers].sort((a, b) => {
    if (b.games_since_played !== a.games_since_played) {
      return b.games_since_played - a.games_since_played;
    }

    if (a.games_played !== b.games_played) {
      return a.games_played - b.games_played;
    }

    return a.id.localeCompare(b.id);
  });

  const candidatePool = sorted.slice(0, Math.min(6, sorted.length));
  const orderedRecentMatches = sortRecentMatchesByRecency(recentMatches);

  if (presentPlayers.length === 6 && candidatePool.length === 6) {
    const strictSixPlayer = recommendSixPlayerMatch(candidatePool, orderedRecentMatches);
    return strictSixPlayer;
  }

  const combos = choose4(candidatePool.map((p) => p.id));
  const maxSit = Math.max(...candidatePool.map((p) => p.games_since_played));
  const mustInclude =
    maxSit > 0
      ? candidatePool
          .filter((p) => p.games_since_played === maxSit)
          .map((p) => p.id)
      : [];

  let best: ScoredSet | null = null;

  for (const ids of combos) {
    if (mustInclude.length <= 4 && !mustInclude.every((id) => ids.includes(id))) {
      continue;
    }

    const players = ids.map((id) => {
      const player = candidatePool.find((p) => p.id === id);
      if (!player) {
        throw new Error("Player lookup failed while scoring");
      }

      return player;
    });

    const teams = bestTeamSplit(players, orderedRecentMatches);
    const sitScore = players.reduce((sum, p) => sum + p.games_since_played, 0);
    const playPenalty = players.reduce((sum, p) => sum + p.games_played, 0);

    const total =
      sitScore * 5 -
      teams.balanceDiff * 1.5 -
      playPenalty * 1 -
      teams.partnerRepeatPenalty * 3;

    const candidate: ScoredSet = {
      playerIds: ids,
      teamA: teams.teamA,
      teamB: teams.teamB,
      sitScore,
      playPenalty,
      balanceDiff: teams.balanceDiff,
      partnerRepeatPenalty: teams.partnerRepeatPenalty,
      total
    };

    if (!best || candidate.total > best.total) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error("Could not find a valid match recommendation");
  }

  return {
    playerIds: best.playerIds,
    teamA: best.teamA,
    teamB: best.teamB,
    balanceDiff: round2(best.balanceDiff),
    partnerRepeatPenalty: best.partnerRepeatPenalty,
    reasons: [
      `Sat priority score: ${best.sitScore}`,
      `Games played penalty: ${best.playPenalty}`,
      `Balance difference: ${round2(best.balanceDiff)}`,
      `Partner repeat penalty: ${best.partnerRepeatPenalty} (lower is better)`
    ]
  };
}

function recommendSixPlayerMatch(
  candidatePool: Player[],
  recentMatches: RecentMatch[]
): Recommendation {
  const built = buildSixPlayerProposals(candidatePool, recentMatches);
  if (built.mustPlay.length !== 0 && built.mustPlay.length !== 2) {
    throw new Error("Could not find a valid match recommendation");
  }

  const proposals = built.proposals;

  if (proposals.length === 0) {
    throw new Error("Could not find a valid match recommendation");
  }

  const hardPool = proposals.filter(
    (proposal) =>
      !proposal.violatesRepeatWindow &&
      !proposal.violatesFiveMatchSitCap &&
      !proposal.violatesFiveMatchPlayCap
  );

  if (hardPool.length === 0) {
    throw new Error(
      "No valid 6-player matchup satisfies no-repeat and sit/play fairness constraints. Adjust presence and try again."
    );
  }

  hardPool.sort(compareSixPlayerRoundRobin);
  const best = hardPool[0];
  const forcedSittersReason =
    built.mustPlay.length === 2
      ? "6-player mode: previous sitters are forced into the next game"
      : "6-player mode: round-robin pairing rotation";

  return {
    playerIds: best.playerIds,
    teamA: best.teamA,
    teamB: best.teamB,
    balanceDiff: round2(best.balanceDiff),
    partnerRepeatPenalty: best.partnerRepeatPenalty,
    reasons: [
      forcedSittersReason,
      `Hard no-repeat window: ${HARD_NO_REPEAT_WINDOW}`,
      `5-match sit cap max after this game: ${best.sitWindowMaxAfter} (target <= 2)`,
      `5-match play cap max after this game: ${5 - best.sitWindowMinAfter} (target <= 4)`,
      `Sat priority score: ${best.sitScore}`,
      `Partner pair repeat usage: max=${best.partnerUsageMax}, sum=${best.partnerRepeatPenalty}`,
      `Opponent repeat usage: max=${best.opponentUsageMax}, sum=${best.opponentRepeatPenalty}`,
      `Games played spread after this match: ${best.playCountSpreadAfter}`,
      `Games played penalty: ${best.playPenalty}`,
      `Balance difference: ${round2(best.balanceDiff)}`
    ]
  };
}

export function validateSubmittedSixPlayerMatchup(
  presentPlayers: Player[],
  recentMatches: RecentMatch[],
  submitted: SubmittedMatchup
) {
  if (presentPlayers.length !== 6) {
    return { ok: true as const };
  }

  const sorted = [...presentPlayers].sort((a, b) => {
    if (b.games_since_played !== a.games_since_played) {
      return b.games_since_played - a.games_since_played;
    }
    if (a.games_played !== b.games_played) {
      return a.games_played - b.games_played;
    }
    return a.id.localeCompare(b.id);
  });

  if (sorted.length !== 6) {
    return { ok: true as const };
  }

  const orderedRecentMatches = sortRecentMatchesByRecency(recentMatches);

  if (
    isMatchupRepeatedInWindow(submitted.teamA, submitted.teamB, orderedRecentMatches, HARD_NO_REPEAT_WINDOW)
  ) {
    return {
      ok: false as const,
      reason: `Matchup was used in the last ${HARD_NO_REPEAT_WINDOW} games. Use a different matchup.`
    };
  }

  return { ok: true as const };
}

function buildSixPlayerProposals(candidatePool: Player[], recentMatches: RecentMatch[]) {
  const mustPlay = getLastRoundSittersInSixPlayerMode(candidatePool, recentMatches);
  const playerById = new Map(candidatePool.map((player) => [player.id, player]));
  const candidateIds = candidatePool.map((player) => player.id);
  const historyCounts = buildHistoryCounts(recentMatches);
  const recentSitWindow = buildRecentSitCounts(candidateIds, recentMatches, SIT_LOOKBACK);
  const enforceFiveMatchCaps = recentSitWindow.roundsCount >= SIT_LOOKBACK;
  const proposals: SixPlayerProposal[] = [];

  for (const ids of choose4(candidateIds)) {
    if (!mustPlay.every((id) => ids.includes(id))) {
      continue;
    }

    const selectedPlayers = ids.map((id) => {
      const player = playerById.get(id);
      if (!player) {
        throw new Error("Player lookup failed while scoring");
      }

      return player;
    });

    const sitScore = selectedPlayers.reduce((sum, player) => sum + player.games_since_played, 0);
    const playPenalty = selectedPlayers.reduce((sum, player) => sum + player.games_played, 0);
    const playingSet = new Set(ids);
    const playCountSpreadAfter = computeGamesPlayedSpreadAfter(candidatePool, playingSet);
    const sitWindow = computeSitWindowAfter(candidateIds, recentSitWindow.counts, playingSet);

    for (const teamOption of buildTeamOptions(selectedPlayers, recentMatches)) {
      const partnerPairA = pairKey(teamOption.teamA[0], teamOption.teamA[1]);
      const partnerPairB = pairKey(teamOption.teamB[0], teamOption.teamB[1]);
      const partnerCountA = mapCount(historyCounts.partnerCounts, partnerPairA);
      const partnerCountB = mapCount(historyCounts.partnerCounts, partnerPairB);
      const opponentPairKeys = getOpponentPairKeys(teamOption.teamA, teamOption.teamB);
      const opponentCounts = opponentPairKeys.map((key) => mapCount(historyCounts.opponentCounts, key));

      proposals.push({
        playerIds: ids,
        teamA: teamOption.teamA,
        teamB: teamOption.teamB,
        sitScore,
        playPenalty,
        balanceDiff: teamOption.balanceDiff,
        partnerRepeatPenalty: partnerCountA + partnerCountB,
        partnerUsageMax: Math.max(partnerCountA, partnerCountB),
        opponentRepeatPenalty: opponentCounts.reduce((sum, count) => sum + count, 0),
        opponentUsageMax: Math.max(...opponentCounts),
        playCountSpreadAfter,
        sitWindowMaxAfter: sitWindow.maxAfter,
        sitWindowMinAfter: sitWindow.minAfter,
        sitWindowTotalAfter: sitWindow.totalAfter,
        violatesFiveMatchSitCap: enforceFiveMatchCaps && sitWindow.maxAfter > 2,
        violatesFiveMatchPlayCap: enforceFiveMatchCaps && sitWindow.minAfter < 1,
        violatesRepeatWindow: isMatchupRepeatedInWindow(
          teamOption.teamA,
          teamOption.teamB,
          recentMatches,
          HARD_NO_REPEAT_WINDOW
        ),
        immediateExactRepeat: teamOption.immediateExactRepeat,
        recentExactRepeat: teamOption.recentExactRepeat,
        matchupKey: teamOption.matchupKey
      });
    }
  }

  return { mustPlay, proposals };
}

function getLastRoundSittersInSixPlayerMode(
  candidatePool: Player[],
  recentMatches: RecentMatch[]
): string[] {
  if (candidatePool.length !== 6) {
    return [];
  }

  const candidateIds = candidatePool.map((player) => player.id);
  const candidateIdSet = new Set(candidateIds);

  for (const match of recentMatches) {
    const played = [...match.team_a, ...match.team_b];
    const uniquePlayed = [...new Set(played)];

    if (uniquePlayed.length !== 4) {
      continue;
    }

    if (!uniquePlayed.every((id) => candidateIdSet.has(id))) {
      continue;
    }

    return candidateIds.filter((id) => !uniquePlayed.includes(id));
  }

  return [];
}

function bestTeamSplit(players: Player[], recentMatches: RecentMatch[]) {
  const options = buildTeamOptions(players, recentMatches);
  const noImmediatePool = options.some((option) => !option.immediateExactRepeat)
    ? options.filter((option) => !option.immediateExactRepeat)
    : options;

  const pool = noImmediatePool.some((option) => !option.recentExactRepeat)
    ? noImmediatePool.filter((option) => !option.recentExactRepeat)
    : noImmediatePool;

  pool.sort((x, y) =>
    x.score - y.score ||
    y.lastUsedIndex - x.lastUsedIndex ||
    x.matchupKey.localeCompare(y.matchupKey)
  );
  return pool[0];
}

function buildTeamOptions(players: Player[], recentMatches: RecentMatch[]): TeamOption[] {
  const [a, b, c, d] = players;

  const options = [
    {
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      balanceDiff: Math.abs(a.rating + b.rating - (c.rating + d.rating))
    },
    {
      teamA: [a.id, c.id],
      teamB: [b.id, d.id],
      balanceDiff: Math.abs(a.rating + c.rating - (b.rating + d.rating))
    },
    {
      teamA: [a.id, d.id],
      teamB: [b.id, c.id],
      balanceDiff: Math.abs(a.rating + d.rating - (b.rating + c.rating))
    }
  ];

  const scored = options.map((option) => {
    const partnerRepeatPenalty = countPartnerRepeats(option.teamA, option.teamB, recentMatches);
    const exactTeamRepeatPenalty = countExactTeamRepeats(option.teamA, option.teamB, recentMatches);
    const immediateExactRepeat = isExactTeamRepeat(option.teamA, option.teamB, recentMatches[0]);
    const recentExactRepeat = isExactTeamRepeatInWindow(
      option.teamA,
      option.teamB,
      recentMatches,
      HARD_NO_REPEAT_WINDOW
    );
    const lastUsedIndex = lastExactTeamRepeatIndex(option.teamA, option.teamB, recentMatches);

    return {
      ...option,
      partnerRepeatPenalty,
      exactTeamRepeatPenalty,
      immediateExactRepeat,
      recentExactRepeat,
      lastUsedIndex,
      score: option.balanceDiff + partnerRepeatPenalty * 1.25 + exactTeamRepeatPenalty * 2,
      matchupKey: matchTeamsKey(option.teamA, option.teamB)
    };
  });

  return scored;
}

function sortRecentMatchesByRecency(recentMatches: RecentMatch[]) {
  return [...recentMatches].sort((a, b) => {
    const aTime = parseMatchTime(a.created_at);
    const bTime = parseMatchTime(b.created_at);

    if (aTime !== null && bTime !== null) {
      if (aTime !== bTime) {
        return bTime - aTime;
      }

      if (typeof a.id === "string" && typeof b.id === "string") {
        return b.id.localeCompare(a.id);
      }

      return 0;
    }

    if (aTime !== null) {
      return -1;
    }

    if (bTime !== null) {
      return 1;
    }

    return 0;
  });
}

function parseMatchTime(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function choose4(ids: string[]) {
  const out: string[][] = [];

  for (let i = 0; i < ids.length - 3; i += 1) {
    for (let j = i + 1; j < ids.length - 2; j += 1) {
      for (let k = j + 1; k < ids.length - 1; k += 1) {
        for (let l = k + 1; l < ids.length; l += 1) {
          out.push([ids[i], ids[j], ids[k], ids[l]]);
        }
      }
    }
  }

  return out;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function countPartnerRepeats(teamA: string[], teamB: string[], recentMatches: RecentMatch[]) {
  const recent = recentMatches.slice(0, 12);
  const keyA = pairKey(teamA[0], teamA[1]);
  const keyB = pairKey(teamB[0], teamB[1]);

  let repeats = 0;

  for (const match of recent) {
    const matchKeyA = pairKey(match.team_a[0], match.team_a[1]);
    const matchKeyB = pairKey(match.team_b[0], match.team_b[1]);

    if (matchKeyA === keyA || matchKeyB === keyA) {
      repeats += 1;
    }

    if (matchKeyA === keyB || matchKeyB === keyB) {
      repeats += 1;
    }
  }

  return repeats;
}

function compareSixPlayerRoundRobin(a: SixPlayerProposal, b: SixPlayerProposal) {
  if (a.violatesRepeatWindow !== b.violatesRepeatWindow) {
    return Number(a.violatesRepeatWindow) - Number(b.violatesRepeatWindow);
  }

  if (a.violatesFiveMatchSitCap !== b.violatesFiveMatchSitCap) {
    return Number(a.violatesFiveMatchSitCap) - Number(b.violatesFiveMatchSitCap);
  }

  if (a.violatesFiveMatchPlayCap !== b.violatesFiveMatchPlayCap) {
    return Number(a.violatesFiveMatchPlayCap) - Number(b.violatesFiveMatchPlayCap);
  }

  if (a.sitWindowMaxAfter !== b.sitWindowMaxAfter) {
    return a.sitWindowMaxAfter - b.sitWindowMaxAfter;
  }

  if (a.sitWindowMinAfter !== b.sitWindowMinAfter) {
    return b.sitWindowMinAfter - a.sitWindowMinAfter;
  }

  if (a.sitWindowTotalAfter !== b.sitWindowTotalAfter) {
    return a.sitWindowTotalAfter - b.sitWindowTotalAfter;
  }

  if (a.partnerUsageMax !== b.partnerUsageMax) {
    return a.partnerUsageMax - b.partnerUsageMax;
  }

  if (a.partnerRepeatPenalty !== b.partnerRepeatPenalty) {
    return a.partnerRepeatPenalty - b.partnerRepeatPenalty;
  }

  if (a.opponentUsageMax !== b.opponentUsageMax) {
    return a.opponentUsageMax - b.opponentUsageMax;
  }

  if (a.opponentRepeatPenalty !== b.opponentRepeatPenalty) {
    return a.opponentRepeatPenalty - b.opponentRepeatPenalty;
  }

  if (a.sitScore !== b.sitScore) {
    return b.sitScore - a.sitScore;
  }

  if (a.playCountSpreadAfter !== b.playCountSpreadAfter) {
    return a.playCountSpreadAfter - b.playCountSpreadAfter;
  }

  if (a.playPenalty !== b.playPenalty) {
    return a.playPenalty - b.playPenalty;
  }

  if (a.balanceDiff !== b.balanceDiff) {
    return a.balanceDiff - b.balanceDiff;
  }

  return a.matchupKey.localeCompare(b.matchupKey);
}

function buildHistoryCounts(recentMatches: RecentMatch[]) {
  const partnerCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();

  for (const match of recentMatches) {
    incrementCount(partnerCounts, pairKey(match.team_a[0], match.team_a[1]));
    incrementCount(partnerCounts, pairKey(match.team_b[0], match.team_b[1]));

    for (const pair of getOpponentPairKeys(match.team_a, match.team_b)) {
      incrementCount(opponentCounts, pair);
    }
  }

  return { partnerCounts, opponentCounts };
}

function getOpponentPairKeys(teamA: string[], teamB: string[]) {
  const keys: string[] = [];

  for (const a of teamA) {
    for (const b of teamB) {
      keys.push(pairKey(a, b));
    }
  }

  return keys;
}

function computeGamesPlayedSpreadAfter(candidatePool: Player[], playingSet: Set<string>) {
  const playedTotals = candidatePool.map((player) =>
    player.games_played + (playingSet.has(player.id) ? 1 : 0)
  );

  return Math.max(...playedTotals) - Math.min(...playedTotals);
}

function buildRecentSitCounts(candidateIds: string[], recentMatches: RecentMatch[], lookback: number) {
  const counts = new Map<string, number>();
  const candidateIdSet = new Set(candidateIds);
  let roundsCount = 0;

  for (const id of candidateIds) {
    counts.set(id, 0);
  }

  for (const match of recentMatches.slice(0, lookback)) {
    const played = [...match.team_a, ...match.team_b];
    const uniquePlayed = [...new Set(played)];

    if (uniquePlayed.length !== 4) {
      continue;
    }

    if (!uniquePlayed.every((id) => candidateIdSet.has(id))) {
      continue;
    }

    roundsCount += 1;
    const playingSet = new Set(uniquePlayed);
    for (const id of candidateIds) {
      if (!playingSet.has(id)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }

  return { counts, roundsCount };
}

function computeSitWindowAfter(
  candidateIds: string[],
  recentSitCounts: Map<string, number>,
  playingSet: Set<string>
) {
  let maxAfter = 0;
  let minAfter = Number.POSITIVE_INFINITY;
  let totalAfter = 0;

  for (const id of candidateIds) {
    const after = (recentSitCounts.get(id) ?? 0) + (playingSet.has(id) ? 0 : 1);
    if (after > maxAfter) {
      maxAfter = after;
    }
    if (after < minAfter) {
      minAfter = after;
    }
    totalAfter += after;
  }

  return { maxAfter, minAfter, totalAfter };
}

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapCount(map: Map<string, number>, key: string) {
  return map.get(key) ?? 0;
}

function countExactTeamRepeats(teamA: string[], teamB: string[], recentMatches: RecentMatch[]) {
  const recent = recentMatches.slice(0, 12);
  let repeats = 0;

  for (const match of recent) {
    if (isExactTeamRepeat(teamA, teamB, match)) {
      repeats += 1;
    }
  }

  return repeats;
}

function isExactTeamRepeat(
  teamA: string[],
  teamB: string[],
  recentMatch: RecentMatch | undefined
) {
  if (!recentMatch) {
    return false;
  }

  const proposalKey = matchTeamsKey(teamA, teamB);
  const recentKey = matchTeamsKey(recentMatch.team_a, recentMatch.team_b);
  return proposalKey === recentKey;
}

function isExactTeamRepeatInWindow(
  teamA: string[],
  teamB: string[],
  recentMatches: RecentMatch[],
  windowSize: number
) {
  const recent = recentMatches.slice(0, windowSize);
  return recent.some((match) => isExactTeamRepeat(teamA, teamB, match));
}

function lastExactTeamRepeatIndex(teamA: string[], teamB: string[], recentMatches: RecentMatch[]) {
  for (let i = 0; i < recentMatches.length; i += 1) {
    if (isExactTeamRepeat(teamA, teamB, recentMatches[i])) {
      return i;
    }
  }

  return -1;
}

function isMatchupRepeatedInWindow(
  teamA: string[],
  teamB: string[],
  recentMatches: RecentMatch[],
  windowSize: number
) {
  const proposalKey = matchTeamsKey(teamA, teamB);
  return recentMatches
    .slice(0, windowSize)
    .some((match) => matchTeamsKey(match.team_a, match.team_b) === proposalKey);
}

function matchTeamsKey(teamA: string[], teamB: string[]) {
  const left = pairKey(teamA[0], teamA[1]);
  const right = pairKey(teamB[0], teamB[1]);
  return [left, right].sort().join("|");
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}
