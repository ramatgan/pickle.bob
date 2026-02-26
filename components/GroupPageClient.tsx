"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Group = {
  id: string;
  name: string;
  slug: string;
};

type Player = {
  id: string;
  group_id: string;
  name: string;
  rating: number;
  is_present: boolean;
  games_since_played: number;
  games_played: number;
};

type Match = {
  id: string;
  group_id: string;
  created_at: string;
  players: string[];
  team_a: string[];
  team_b: string[];
  score_a: number;
  score_b: number;
  rating_deltas: Record<string, number>;
};

type Recommendation = {
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  balanceDiff: number;
  partnerRepeatPenalty: number;
  reasons: string[];
};

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function GroupPageClient({ slug }: { slug: string }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [sharePin, setSharePin] = useState("");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerRating, setNewPlayerRating] = useState("3.5");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [replaceOutId, setReplaceOutId] = useState("");
  const [replaceInId, setReplaceInId] = useState("");
  const [showReplaceControls, setShowReplaceControls] = useState(false);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [lastScoreDeltas, setLastScoreDeltas] = useState<Record<string, number> | null>(null);
  const [activeArea, setActiveArea] = useState<"match" | "setup">("match");
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, { scoreA: string; scoreB: string }>>({});
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const scoreAInputRef = useRef<HTMLInputElement | null>(null);
  const submitInFlightRef = useRef(false);
  const refreshGroupSeqRef = useRef(0);
  const refreshRecommendationSeqRef = useRef(0);

  const unlocked = Boolean(token);
  const canSubmitScore = Boolean(
    unlocked && !loading && recommendation && parseScore(scoreA) !== null && parseScore(scoreB) !== null
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const player of players) {
      map.set(player.id, player.name);
    }
    return map;
  }, [players]);

  const playerById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const player of players) {
      map.set(player.id, player);
    }
    return map;
  }, [players]);

  const presentPlayers = useMemo(() => players.filter((player) => player.is_present), [players]);
  const replacementSitters = useMemo(() => {
    if (!recommendation) {
      return [];
    }

    const playing = new Set(recommendation.playerIds);
    return presentPlayers.filter((player) => !playing.has(player.id));
  }, [presentPlayers, recommendation]);

  useEffect(() => {
    const stored = safeStorageGet(`pb-editor:${slug}`);
    if (stored) {
      setToken(stored);
    }
  }, [slug]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const sharedPin = url.searchParams.get("pin");

    if (sharedPin) {
      setPin(sharedPin);
      setSharePin(sharedPin);
      setActiveArea("setup");
    }

    if (sharedPin) {
      url.searchParams.delete("pin");
      const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}${url.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [slug]);

  useEffect(() => {
    setTheme(isNightTimeLocal(new Date()) ? "dark" : "light");
  }, []);

  useEffect(() => {
    setGroup(null);
    setPlayers([]);
    setMatches([]);
    setRecommendation(null);
    setLastScoreDeltas(null);
    setScoreA("");
    setScoreB("");
    setReplaceOutId("");
    setReplaceInId("");
    setShareNotice(null);
    setError(null);
    void refreshGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!recommendation) {
      setReplaceOutId("");
      setReplaceInId("");
      setShowReplaceControls(false);
      return;
    }

    const nextOut = recommendation.playerIds.includes(replaceOutId)
      ? replaceOutId
      : recommendation.playerIds[0] ?? "";
    const sitterIds = replacementSitters.map((player) => player.id);
    const nextIn = sitterIds.includes(replaceInId) ? replaceInId : sitterIds[0] ?? "";

    if (nextOut !== replaceOutId) {
      setReplaceOutId(nextOut);
    }
    if (nextIn !== replaceInId) {
      setReplaceInId(nextIn);
    }
  }, [recommendation, replaceInId, replaceOutId, replacementSitters]);

  useEffect(() => {
    if (theme !== null) {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    if (!recommendation) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      scoreAInputRef.current?.focus();
      scoreAInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [recommendation]);

  async function refreshGroup() {
    const requestSeq = ++refreshGroupSeqRef.current;
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (requestSeq !== refreshGroupSeqRef.current) {
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Failed to load group");
        return;
      }

      setGroup(data.group);
      setPlayers(data.players ?? []);
      setMatches((current) => mergeMatches(current, normalizeMatches(data.matches ?? [])));
    } catch {
      if (requestSeq !== refreshGroupSeqRef.current) {
        return;
      }
      setError("Failed to load group");
    }
  }

  async function unlockEditor() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unlock failed");
        return;
      }

      setToken(data.token);
      safeStorageSet(`pb-editor:${slug}`, data.token);
      setSharePin(pin);
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  async function copyShareLink(mode: "view" | "pin") {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";

    if (mode === "pin") {
      if (sharePin.trim().length < 4) {
        setError("Enter the group PIN in Share before copying a PIN link.");
        return;
      }
      url.searchParams.set("pin", sharePin.trim());
    }

    const shareUrl = url.toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }

      setShareNotice(mode === "pin" ? "PIN link copied." : "View link copied.");
      setError(null);
    } catch {
      setError("Could not copy link");
    }
  }

  async function addPlayer() {
    if (!token || !newPlayerName.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}/players`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token)
        },
        body: JSON.stringify({
          action: "add",
          name: newPlayerName.trim(),
          rating: Number(newPlayerRating)
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to add player");
        return;
      }

      setPlayers(data.players ?? []);
      setNewPlayerName("");
    } finally {
      setLoading(false);
    }
  }

  async function togglePresence(playerId: string, isPresent: boolean) {
    if (!token) {
      return;
    }

    const optimistic = players.map((player) =>
      player.id === playerId ? { ...player, is_present: isPresent } : player
    );
    setPlayers(optimistic);

    const res = await fetch(`/api/group/${slug}/players`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(token)
      },
      body: JSON.stringify({
        action: "presence",
        updates: [{ playerId, isPresent }]
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Unable to update presence");
      await refreshGroup();
      return;
    }

    setPlayers(data.players ?? optimistic);
  }

  async function recommendMatch() {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}/recommend`, {
        method: "POST",
        headers: authHeaders(token)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not recommend next match");
        return;
      }

      setRecommendation(data.recommendation);
      setScoreA("");
      setScoreB("");
    } finally {
      setLoading(false);
    }
  }

  async function submitScore() {
    if (!token || !recommendation || submitInFlightRef.current) {
      return;
    }

    const parsedScoreA = parseScore(scoreA);
    const parsedScoreB = parseScore(scoreB);
    if (parsedScoreA === null || parsedScoreB === null) {
      setError("Enter valid numeric scores between 0 and 99");
      return;
    }

    submitInFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}/submit_score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token)
        },
        body: JSON.stringify({
          playerIds: recommendation.playerIds,
          teamA: recommendation.teamA,
          teamB: recommendation.teamB,
          scoreA: parsedScoreA,
          scoreB: parsedScoreB
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof data.error === "string" && data.error.includes("Matchup was used in the last")) {
          await refreshRecommendationAfterStaleSubmit();
          setError(data.error);
          return;
        }

        if (
          typeof data.error === "string" &&
          (data.error.includes("6-player fairness rule") ||
            data.error.includes("last round sitters must play next") ||
            data.error.includes("Submitted matchup is not valid"))
        ) {
          await refreshRecommendationAfterStaleSubmit();
          setError(data.error);
          return;
        }

        if (isStaleRecommendationError(data.error)) {
          await refreshRecommendationAfterStaleSubmit();
          setError("Matchup changed. Loaded the latest recommendation. Enter scores and submit again.");
          return;
        }

        setError(data.error ?? "Could not submit score");
        return;
      }

      const savedMatch = normalizeMatch(data.match);
      if (savedMatch) {
        setMatches((current) => mergeMatches(current, [savedMatch]));
      }

      setLastScoreDeltas(normalizeRatingDeltas(data.match?.rating_deltas));
      setRecommendation(data.nextRecommendation ?? null);
      setScoreA("");
      setScoreB("");
      await refreshGroup();
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function refreshRecommendationAfterStaleSubmit() {
    if (!token) {
      return;
    }

    const requestSeq = ++refreshRecommendationSeqRef.current;

    try {
      const res = await fetch(`/api/group/${slug}/recommend`, {
        method: "POST",
        headers: authHeaders(token)
      });
      const data = await res.json().catch(() => ({}));
      if (requestSeq !== refreshRecommendationSeqRef.current) {
        return;
      }
      if (res.ok) {
        setRecommendation(data.recommendation ?? null);
        setScoreA("");
        setScoreB("");
      }
    } catch {
      // Keep the current screen state when recommendation refresh fails.
    } finally {
      await refreshGroup();
    }
  }

  function replaceRecommendedPlayer() {
    if (!recommendation) {
      return;
    }

    if (!replaceOutId || !replaceInId || replaceOutId === replaceInId) {
      setError("Choose one current player and one sitter to replace.");
      return;
    }

    if (!recommendation.playerIds.includes(replaceOutId)) {
      setError("Player to replace is not in the recommended lineup.");
      return;
    }

    if (recommendation.playerIds.includes(replaceInId)) {
      setError("Replacement player is already in the recommended lineup.");
      return;
    }

    const nextTeamA = recommendation.teamA.map((id) => (id === replaceOutId ? replaceInId : id));
    const nextTeamB = recommendation.teamB.map((id) => (id === replaceOutId ? replaceInId : id));
    const nextPlayerIds = [...nextTeamA, ...nextTeamB];

    if (new Set(nextPlayerIds).size !== 4) {
      setError("Replacement must result in exactly 4 unique players.");
      return;
    }

    setRecommendation({
      ...recommendation,
      playerIds: nextPlayerIds,
      teamA: nextTeamA,
      teamB: nextTeamB,
      balanceDiff: calculateBalanceDiff(nextTeamA, nextTeamB, playerById)
    });
    setScoreA("");
    setScoreB("");
    setError(null);
  }

  function toggleHistoryMatch(match: Match) {
    setExpandedMatchId((current) => {
      const next = current === match.id ? null : match.id;
      if (next !== match.id) {
        setEditingMatchId(null);
      }
      return next;
    });
    setEditDrafts((current) => {
      if (current[match.id]) {
        return current;
      }

      return {
        ...current,
        [match.id]: {
          scoreA: String(match.score_a),
          scoreB: String(match.score_b)
        }
      };
    });
  }

  function updateEditDraft(matchId: string, key: "scoreA" | "scoreB", value: string) {
    setEditDrafts((current) => ({
      ...current,
      [matchId]: {
        scoreA: current[matchId]?.scoreA ?? "",
        scoreB: current[matchId]?.scoreB ?? "",
        [key]: value
      }
    }));
  }

  async function saveEditedScore(match: Match) {
    if (!token) {
      return;
    }

    const draft = editDrafts[match.id] ?? {
      scoreA: String(match.score_a),
      scoreB: String(match.score_b)
    };
    const parsedScoreA = parseScore(draft.scoreA);
    const parsedScoreB = parseScore(draft.scoreB);
    if (parsedScoreA === null || parsedScoreB === null) {
      setError("Enter valid numeric scores between 0 and 99");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group/${slug}/edit_score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token)
        },
        body: JSON.stringify({
          matchId: match.id,
          scoreA: parsedScoreA,
          scoreB: parsedScoreB
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not edit score");
        return;
      }

      const updatedMatch = normalizeMatch(data.match);
      if (updatedMatch) {
        setMatches((current) => mergeMatches(current, [updatedMatch]));
      }

      setLastScoreDeltas(normalizeRatingDeltas(data.match?.rating_deltas));
      setEditingMatchId(null);
      void refreshGroup();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>{group?.name ?? slug}</h1>

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <div
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap"
        }}
      >
        <div className="row">
          <button
            type="button"
            className={activeArea === "match" ? "" : "secondary"}
            onClick={() => setActiveArea("match")}
          >
            Match Day
          </button>
          <button
            type="button"
            className={activeArea === "setup" ? "" : "secondary"}
            onClick={() => setActiveArea("setup")}
          >
            Setup
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light Mode" : "Night Mode"}
        </button>
      </div>

      {activeArea === "setup" && (
        <>
          {!unlocked ? (
            <div className="card">
              <h2>Unlock Editing</h2>
              <p className="small">Enter Group PIN once to enable roster editing and score submission.</p>
              <div className="row">
                <input
                  id="group-pin"
                  name="groupPin"
                  placeholder="Group PIN"
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                />
                <button disabled={loading || !pin} onClick={() => void unlockEditor()} type="button">
                  Unlock
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2>Editing Enabled</h2>
              <p className="small">This device is unlocked. You can manage roster and submit scores.</p>
            </div>
          )}

          <div className="card">
            <h2>Share</h2>
            <p className="small">Share a view link or a PIN-prefilled link.</p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => void copyShareLink("view")}>
                Copy View Link
              </button>
              <input
                id="share-pin"
                name="sharePin"
                placeholder="PIN for link"
                type="password"
                value={sharePin}
                onChange={(event) => setSharePin(event.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={sharePin.trim().length < 4}
                onClick={() => void copyShareLink("pin")}
              >
                Copy PIN Link
              </button>
            </div>
            {shareNotice && <p className="small">{shareNotice}</p>}
          </div>

          <div className="card">
            <h2>Roster</h2>
            <ul>
              {players.map((player) => (
                <li key={player.id}>
                  <label>
                    <input
                      id={`presence-${player.id}`}
                      name={`presence-${player.id}`}
                      type="checkbox"
                      checked={player.is_present}
                      disabled={!unlocked}
                      onChange={(event) => void togglePresence(player.id, event.target.checked)}
                    />{" "}
                    {player.name} (rating {formatRating(player.rating)}) | played {player.games_played} | sat{" "}
                    {player.games_since_played}
                  </label>
                </li>
              ))}
            </ul>

            {unlocked && (
              <div className="row">
                <input
                  id="new-player-name"
                  name="newPlayerName"
                  placeholder="Player name"
                  value={newPlayerName}
                  onChange={(event) => setNewPlayerName(event.target.value)}
                />
                <input
                  id="new-player-rating"
                  name="newPlayerRating"
                  placeholder="Rating"
                  inputMode="decimal"
                  value={newPlayerRating}
                  onChange={(event) => setNewPlayerRating(event.target.value)}
                />
                <button
                  disabled={loading || !newPlayerName}
                  onClick={() => void addPlayer()}
                  type="button"
                >
                  Add Player
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {activeArea === "match" && (
        <>
          {!unlocked && (
            <div className="card">
              <p className="small">
                To run matches and submit scores, unlock once in the <strong>Setup</strong> area.
              </p>
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Next Match</h2>
              {recommendation && replacementSitters.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  aria-label="Toggle replacement controls"
                  title="Replace recommended players"
                  style={{ padding: "4px 8px", minWidth: 34, lineHeight: 1 }}
                  onClick={() => setShowReplaceControls((current) => !current)}
                >
                  ⚙
                </button>
              )}
            </div>
            {!recommendation ? (
              <div className="row">
                <button disabled={!unlocked || loading} onClick={() => void recommendMatch()} type="button">
                  Recommend Next Match
                </button>
              </div>
            ) : (
              <>
                <div className="next-match-vs">
                  <div className="next-match-pair next-match-pair-left">
                    {recommendation.teamA.map((id) => nameById.get(id) ?? id).join(" + ")}
                  </div>
                  <div className="next-match-score">
                    <input
                      ref={scoreAInputRef}
                      id="next-score-a"
                      name="nextScoreA"
                      className="score-input"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Score for ${recommendation.teamA.map((id) => nameById.get(id) ?? id).join(" + ")}`}
                      placeholder="0"
                      value={scoreA}
                      onChange={(event) => setScoreA(sanitizeScoreInput(event.target.value))}
                    />
                    <span className="score-sep">-</span>
                    <input
                      id="next-score-b"
                      name="nextScoreB"
                      className="score-input"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Score for ${recommendation.teamB.map((id) => nameById.get(id) ?? id).join(" + ")}`}
                      placeholder="0"
                      value={scoreB}
                      onChange={(event) => setScoreB(sanitizeScoreInput(event.target.value))}
                    />
                  </div>
                  <div className="next-match-pair next-match-pair-right">
                    {recommendation.teamB.map((id) => nameById.get(id) ?? id).join(" + ")}
                  </div>
                </div>
                {showReplaceControls && replacementSitters.length > 0 && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <label htmlFor="replace-out">Replace</label>
                    <select
                      id="replace-out"
                      name="replaceOut"
                      value={replaceOutId}
                      onChange={(event) => setReplaceOutId(event.target.value)}
                    >
                      {recommendation.playerIds.map((playerId) => (
                        <option key={playerId} value={playerId}>
                          {nameById.get(playerId) ?? playerId}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="replace-in">with</label>
                    <select
                      id="replace-in"
                      name="replaceIn"
                      value={replaceInId}
                      onChange={(event) => setReplaceInId(event.target.value)}
                    >
                      {replacementSitters.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={loading || !replaceOutId || !replaceInId}
                      onClick={replaceRecommendedPlayer}
                    >
                      Replace Player
                    </button>
                  </div>
                )}
                <div className="row">
                  <button
                    disabled={!canSubmitScore}
                    onClick={() => void submitScore()}
                    type="button"
                  >
                    Submit Score & Next Match
                  </button>
                </div>
                {lastScoreDeltas && (
                  <p className="small">Rating changes: {formatDeltaSummary(lastScoreDeltas, nameById)}</p>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h2>History</h2>
            {matches.length === 0 ? (
              <p className="small">No matches yet.</p>
            ) : (
              <ul>
                {matches.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      className="secondary"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        display: "block"
                      }}
                      onClick={() => toggleHistoryMatch(match)}
                    >
                      {match.team_a.map((id) => nameById.get(id) ?? id).join(" + ")} {match.score_a} -{" "}
                      {match.score_b} {match.team_b.map((id) => nameById.get(id) ?? id).join(" + ")}
                    </button>

                    {expandedMatchId === match.id && (
                      <div className="small" style={{ marginTop: 8 }}>
                        <p style={{ margin: 0 }}>Recorded: {formatRecordedAt(match.created_at)}</p>
                        <p style={{ margin: "8px 0 0 0" }}>
                          Score: {match.score_a} - {match.score_b}
                        </p>
                        {Object.keys(match.rating_deltas ?? {}).length > 0 && (
                          <p style={{ margin: "8px 0 0 0" }}>
                            Rating changes: {formatDeltaSummary(match.rating_deltas, nameById)}
                          </p>
                        )}

                        {unlocked && (
                          <>
                            {editingMatchId !== match.id ? (
                              <div className="row" style={{ marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={loading}
                                  onClick={() => setEditingMatchId(match.id)}
                                >
                                  Edit
                                </button>
                              </div>
                            ) : (
                              <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
                                <strong>Edit Score</strong>
                                <input
                                  id={`edit-score-a-${match.id}`}
                                  name={`editScoreA-${match.id}`}
                                  className="score-input"
                                  type="tel"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editDrafts[match.id]?.scoreA ?? String(match.score_a)}
                                  onChange={(event) =>
                                    updateEditDraft(
                                      match.id,
                                      "scoreA",
                                      sanitizeScoreInput(event.target.value)
                                    )
                                  }
                                />
                                <span>-</span>
                                <input
                                  id={`edit-score-b-${match.id}`}
                                  name={`editScoreB-${match.id}`}
                                  className="score-input"
                                  type="tel"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editDrafts[match.id]?.scoreB ?? String(match.score_b)}
                                  onChange={(event) =>
                                    updateEditDraft(
                                      match.id,
                                      "scoreB",
                                      sanitizeScoreInput(event.target.value)
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void saveEditedScore(match)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={loading}
                                  onClick={() => setEditingMatchId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function formatSignedDelta(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(3)}`;
}

function formatRating(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }

  return numeric.toFixed(2);
}

function formatDeltaSummary(deltas: Record<string, number>, nameById: Map<string, string>) {
  return Object.entries(deltas)
    .map(([playerId, delta]) => `${nameById.get(playerId) ?? playerId} ${formatSignedDelta(delta)}`)
    .join(" | ");
}

function formatRecordedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function sanitizeScoreInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 2);
}

function isNightTimeLocal(date: Date) {
  const hour = date.getHours();
  return hour >= 19 || hour < 7;
}

function isStaleRecommendationError(error: unknown) {
  if (typeof error !== "string") {
    return false;
  }

  const message = error.toLowerCase();
  return (
    message.includes("recommendation changed") ||
    message.includes("last round sitters must play next")
  );
}

function parseScore(value: string) {
  if (!/^\d{1,2}$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
    return null;
  }

  return parsed;
}

function calculateBalanceDiff(teamA: string[], teamB: string[], playerById: Map<string, Player>) {
  const sumRatings = (ids: string[]) =>
    ids.reduce((total, id) => total + (playerById.get(id)?.rating ?? 0), 0);

  return Math.round(Math.abs(sumRatings(teamA) - sumRatings(teamB)) * 100) / 100;
}

function normalizeMatches(input: unknown): Match[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((item) => normalizeMatch(item)).filter((match): match is Match => match !== null);
}

function normalizeMatch(input: unknown): Match | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const match = input as Match;

  if (typeof match.id !== "string") {
    return null;
  }

  return {
    ...match,
    rating_deltas: normalizeRatingDeltas((match as { rating_deltas?: unknown }).rating_deltas) ?? {}
  };
}

function mergeMatches(current: Match[], incoming: Match[]) {
  const byId = new Map<string, Match>();

  for (const match of current) {
    byId.set(match.id, match);
  }

  for (const match of incoming) {
    byId.set(match.id, match);
  }

  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;

    if (safeBTime !== safeATime) {
      return safeBTime - safeATime;
    }

    return b.id.localeCompare(a.id);
  });
}

function normalizeRatingDeltas(value: unknown): Record<string, number> | null {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const parsed: Record<string, number> = {};

  for (const [key, delta] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(delta);
    if (Number.isFinite(numeric)) {
      parsed[key] = numeric;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

function safeStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (privacy mode/quota) to avoid crashing the app.
  }
}
