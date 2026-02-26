import { NextRequest } from "next/server";
import { notFound, ok, serverError } from "@/lib/api";
import { getGroupBySlug, listMatches, listPlayers } from "@/lib/repository";

export const dynamic = "force-dynamic";
const HISTORY_LIMIT = 1000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const group = await getGroupBySlug(slug);
    if (!group) {
      return notFound("Group not found");
    }

    const [players, matches] = await Promise.all([
      listPlayers(group.id),
      listMatches(group.id, HISTORY_LIMIT)
    ]);

    return ok({ group, players, matches });
  } catch {
    return serverError();
  }
}
