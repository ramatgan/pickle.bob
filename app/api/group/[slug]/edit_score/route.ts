import { NextRequest } from "next/server";
import { badRequest, notFound, ok, parseJson, requireEditor, serverError } from "@/lib/api";
import { editScoreSchema } from "@/lib/schemas";
import { editMatchScore, getGroupBySlug } from "@/lib/repository";

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

    const parsed = await parseJson(request, editScoreSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const updated = await editMatchScore({
      groupId: group.id,
      matchId: parsed.data.matchId,
      scoreA: parsed.data.scoreA,
      scoreB: parsed.data.scoreB
    });

    return ok({ match: updated });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Match not found")) {
        return notFound(error.message);
      }

      if (error.message.includes("cannot be edited") || error.message.includes("failed")) {
        return badRequest(error.message);
      }
    }

    return serverError();
  }
}
