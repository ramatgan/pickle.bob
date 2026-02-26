import { NextRequest } from "next/server";
import { notFound, ok, parseJson, requireEditor, serverError } from "@/lib/api";
import {
  addPlayer,
  getGroupBySlug,
  listPlayers,
  setPresence,
  updatePlayer
} from "@/lib/repository";
import { playersMutationSchema } from "@/lib/schemas";

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

    const parsed = await parseJson(request, playersMutationSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const mutation = parsed.data;

    if (mutation.action === "add") {
      await addPlayer({
        groupId: group.id,
        name: mutation.name,
        rating: mutation.rating
      });
    }

    if (mutation.action === "presence") {
      await setPresence({ groupId: group.id, updates: mutation.updates });
    }

    if (mutation.action === "update") {
      await updatePlayer({
        groupId: group.id,
        playerId: mutation.playerId,
        name: mutation.name,
        rating: mutation.rating
      });
    }

    const players = await listPlayers(group.id);
    return ok({ players });
  } catch {
    return serverError();
  }
}
