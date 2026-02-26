import { NextRequest } from "next/server";
import { badRequest, notFound, ok, requireEditor, serverError } from "@/lib/api";
import {
  logMatchmakerEvent,
  summarizePresentPlayers,
  summarizeRecentMatches,
  teamsKey
} from "@/lib/matchmakerDebug";
import { recommendNextMatch } from "@/lib/matchmaker";
import { getGroupBySlug, getPresentPlayers, listRecentMatches } from "@/lib/repository";

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

    const presentPlayers = await getPresentPlayers(group.id);
    if (presentPlayers.length < 4) {
      return badRequest("Need at least 4 present players");
    }

    const recentMatches = await listRecentMatches(group.id, 12);
    const recommendation = recommendNextMatch(presentPlayers, recentMatches);
    const selectedKey = teamsKey(recommendation.teamA, recommendation.teamB);
    const latestKey = recentMatches[0]
      ? teamsKey(recentMatches[0].team_a, recentMatches[0].team_b)
      : null;

    logMatchmakerEvent("recommend", {
      groupId: group.id,
      slug,
      selectedKey,
      latestKey,
      repeatsLatest: selectedKey === latestKey,
      presentPlayers: summarizePresentPlayers(presentPlayers),
      recentMatches: summarizeRecentMatches(recentMatches)
    });

    return ok({ recommendation });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("At least 4 present")) {
        return badRequest("Need at least 4 present players");
      }

      if (error.message.includes("No valid 6-player matchup satisfies")) {
        return badRequest(error.message);
      }
    }

    return serverError();
  }
}
