type RecentMatchLog = {
  id?: string;
  created_at?: string;
  team_a: string[];
  team_b: string[];
};

type PresentPlayerLog = {
  id: string;
  name: string;
  rating: number;
  games_since_played: number;
  games_played: number;
};

const debugDbTarget = resolveDebugDbTarget();

export function isMatchmakerDebugEnabled() {
  return process.env.MATCHMAKER_DEBUG === "1";
}

export function logMatchmakerEvent(event: string, payload: Record<string, unknown>) {
  if (!isMatchmakerDebugEnabled()) {
    return;
  }

  const envelope = {
    ts: new Date().toISOString(),
    pid: process.pid,
    db: debugDbTarget,
    event,
    ...payload
  };

  console.log(`[matchmaker-debug] ${JSON.stringify(envelope)}`);
}

export function teamsKey(teamA: string[], teamB: string[]) {
  const left = pairKey(teamA[0], teamA[1]);
  const right = pairKey(teamB[0], teamB[1]);
  return [left, right].sort().join("|");
}

export function summarizeRecentMatches(recentMatches: RecentMatchLog[], limit = 6) {
  return recentMatches.slice(0, limit).map((match, index) => ({
    index,
    id: match.id ?? null,
    created_at: match.created_at ?? null,
    key: teamsKey(match.team_a, match.team_b),
    team_a: match.team_a,
    team_b: match.team_b
  }));
}

export function summarizePresentPlayers(presentPlayers: PresentPlayerLog[]) {
  return presentPlayers.map((player) => ({
    id: player.id,
    name: player.name,
    rating: player.rating,
    games_since_played: player.games_since_played,
    games_played: player.games_played
  }));
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function resolveDebugDbTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return "unknown";
  }

  try {
    const parsed = new URL(raw);
    const dbName = parsed.pathname.replace(/^\/+/, "") || "unknown";
    return `${parsed.hostname}:${parsed.port || "5432"}/${dbName}`;
  } catch {
    return "invalid-url";
  }
}
