import { NextRequest } from "next/server";
import { badRequest, notFound, ok, parseJson, requireEditor, serverError } from "@/lib/api";
import { logMatchmakerEvent, summarizePresentPlayers, teamsKey } from "@/lib/matchmakerDebug";
import { getGroupBySlug, saveMatchAndUpdateState } from "@/lib/repository";
import { submitScoreSchema } from "@/lib/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const group = await getGroupBySlug(slug);
    if (!group) {
      return notFound("Group not found");
    }

    const auth = await requireEditor(request, group.id);
    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseJson(request, submitScoreSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.data;
    const shapeError = validateMatchShape(body.playerIds, body.teamA, body.teamB);
    if (shapeError) {
      return badRequest(shapeError);
    }

    const saveResult = await saveMatchAndUpdateState({
      groupId: group.id,
      playerIds: body.playerIds,
      teamA: body.teamA,
      teamB: body.teamB,
      scoreA: body.scoreA,
      scoreB: body.scoreB
    });

    const savedMatch = saveResult.match;
    const nextRecommendation = saveResult.nextRecommendation;
    const postSubmitPresentPlayers = saveResult.postSubmitPresentPlayers;

    logMatchmakerEvent("submit_saved", {
      groupId: group.id,
      slug,
      matchId: savedMatch.id,
      matchCreatedAt: savedMatch.created_at,
      submittedPlayers: [...body.playerIds].sort(),
      submittedKey: teamsKey(body.teamA, body.teamB),
      scoreA: body.scoreA,
      scoreB: body.scoreB,
      nextRecommendationKey: nextRecommendation
        ? teamsKey(nextRecommendation.teamA, nextRecommendation.teamB)
        : null,
      postSubmitPresentPlayers: summarizePresentPlayers(postSubmitPresentPlayers)
    });

    return ok({
      match: savedMatch,
      nextRecommendation
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Submitted players must be present")) {
        return badRequest(error.message);
      }

      if (error.message.includes("Recommendation changed")) {
        return badRequest(error.message);
      }

      if (error.message.includes("Matchup was used in the last")) {
        return badRequest(error.message);
      }

      if (error.message.includes("6-player fairness rule")) {
        return badRequest(error.message);
      }

      if (error.message.includes("In 6-player mode, last round sitters must play next")) {
        return badRequest(error.message);
      }

      if (error.message.includes("Submitted matchup is not valid")) {
        return badRequest(error.message);
      }
    }

    console.error("[submit_score] unhandled error:", error);
    return serverError();
  }
}

function validateMatchShape(playerIds: string[], teamA: string[], teamB: string[]) {
  const allPlayers = new Set(playerIds);
  const teamPlayers = [...teamA, ...teamB];
  const teamSet = new Set(teamPlayers);

  if (allPlayers.size !== 4) {
    return "playerIds must include exactly 4 unique players";
  }

  if (teamSet.size !== 4) {
    return "Teams must contain 4 unique players";
  }

  for (const id of teamSet) {
    if (!allPlayers.has(id)) {
      return "Teams must be a split of playerIds";
    }
  }

  return null;
}
