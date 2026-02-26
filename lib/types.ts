export interface Group {
  id: string;
  name: string;
  slug: string;
}

export interface GroupWithPin extends Group {
  pin_hash: string;
}

export interface Player {
  id: string;
  group_id: string;
  name: string;
  rating: number;
  is_present: boolean;
  games_since_played: number;
  games_played: number;
}

export interface Match {
  id: string;
  group_id: string;
  created_at: string;
  players: string[];
  team_a: string[];
  team_b: string[];
  score_a: number;
  score_b: number;
  rating_deltas: Record<string, number>;
  pre_match_ratings: Record<string, number>;
}

export interface Recommendation {
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  balanceDiff: number;
  partnerRepeatPenalty: number;
  reasons: string[];
}
