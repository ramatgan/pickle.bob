interface RatingUpdateInput {
  ratingsById: Record<string, number>;
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
}

interface RatingUpdateResult {
  deltasById: Record<string, number>;
  newRatingsById: Record<string, number>;
  diagnostics: {
    teamExpectedA: number;
    marginMultiplier: number;
    teamTotalDeltaA: number;
  };
}

interface RatingEditAdjustmentsInput {
  playerIds: string[];
  oldDeltas: Record<string, number>;
  newDeltas: Record<string, number>;
}

interface RatingEditAdjustment {
  playerId: string;
  delta: number;
}

const MIN_RATING = 0;
const MAX_RATING = 8;
const ELO_SCALE = 1.5;
const BASE_K = 0.2;

export function calculateDoublesRatingUpdate(input: RatingUpdateInput): RatingUpdateResult {
  if (input.teamA.length !== 2 || input.teamB.length !== 2) {
    throw new Error("Doubles rating update requires exactly 2 players per team");
  }

  const [a1, a2] = input.teamA;
  const [b1, b2] = input.teamB;

  const a1Rating = getRating(input.ratingsById, a1);
  const a2Rating = getRating(input.ratingsById, a2);
  const b1Rating = getRating(input.ratingsById, b1);
  const b2Rating = getRating(input.ratingsById, b2);

  const avgA = average(input.teamA.map((id) => input.ratingsById[id]));
  const avgB = average(input.teamB.map((id) => input.ratingsById[id]));

  const teamExpectedA = 1 / (1 + 10 ** ((avgB - avgA) / ELO_SCALE));
  const actualA = input.scoreA === input.scoreB ? 0.5 : input.scoreA > input.scoreB ? 1 : 0;

  const marginMultiplier = 1 + Math.abs(input.scoreA - input.scoreB) / 11;
  const teamTotalDeltaA = BASE_K * marginMultiplier * (actualA - teamExpectedA) * 2;
  const teamTotalDeltaB = -teamTotalDeltaA;

  const leverageA1 = playerLeverage({
    playerRating: a1Rating,
    partnerRating: a2Rating,
    opponentAverageRating: avgB
  });
  const leverageA2 = playerLeverage({
    playerRating: a2Rating,
    partnerRating: a1Rating,
    opponentAverageRating: avgB
  });
  const leverageB1 = playerLeverage({
    playerRating: b1Rating,
    partnerRating: b2Rating,
    opponentAverageRating: avgA
  });
  const leverageB2 = playerLeverage({
    playerRating: b2Rating,
    partnerRating: b1Rating,
    opponentAverageRating: avgA
  });

  const [shareA1, shareA2] = normalizePair(leverageA1, leverageA2);
  const [shareB1, shareB2] = normalizePair(leverageB1, leverageB2);

  const deltasById: Record<string, number> = {
    [a1]: teamTotalDeltaA * shareA1,
    [a2]: teamTotalDeltaA * shareA2,
    [b1]: teamTotalDeltaB * shareB1,
    [b2]: teamTotalDeltaB * shareB2
  };

  const newRatingsById: Record<string, number> = {};

  for (const id of [...input.teamA, ...input.teamB]) {
    const oldRating = getRating(input.ratingsById, id);
    const nextRating = clamp(oldRating + deltasById[id], MIN_RATING, MAX_RATING);
    newRatingsById[id] = round3(nextRating);
    deltasById[id] = round3(nextRating - oldRating);
  }

  return {
    deltasById,
    newRatingsById,
    diagnostics: {
      teamExpectedA: round3(teamExpectedA),
      marginMultiplier: round3(marginMultiplier),
      teamTotalDeltaA: round3(teamTotalDeltaA)
    }
  };
}

export function buildRatingEditAdjustments(
  input: RatingEditAdjustmentsInput
): RatingEditAdjustment[] {
  const adjustments: RatingEditAdjustment[] = [];

  for (const playerId of input.playerIds) {
    const delta = (input.newDeltas[playerId] ?? 0) - (input.oldDeltas[playerId] ?? 0);
    if (Math.abs(delta) < 0.000001) {
      continue;
    }

    adjustments.push({ playerId, delta });
  }

  return adjustments;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function getRating(ratingsById: Record<string, number>, playerId: string) {
  const value = Number(ratingsById[playerId]);
  if (!Number.isFinite(value)) {
    throw new Error(`Missing rating for player ${playerId}`);
  }

  return value;
}

function playerLeverage({
  playerRating,
  partnerRating,
  opponentAverageRating
}: {
  playerRating: number;
  partnerRating: number;
  opponentAverageRating: number;
}) {
  const contextRating = playerRating * 0.7 + partnerRating * 0.3;
  const gap = opponentAverageRating - contextRating;
  return clamp(1 + gap / 4, 0.65, 1.35);
}

function normalizePair(a: number, b: number): [number, number] {
  const sum = a + b;
  if (sum <= 0) {
    return [0.5, 0.5];
  }

  return [a / sum, b / sum];
}
