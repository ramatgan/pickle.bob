import { NextRequest } from "next/server";
import { notFound, ok, parseJson, serverError, unauthorized } from "@/lib/api";
import { signEditToken, verifyPin } from "@/lib/auth";
import { getGroupWithPinBySlug } from "@/lib/repository";
import { unlockSchema } from "@/lib/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const group = await getGroupWithPinBySlug(slug);
    if (!group) {
      return notFound("Group not found");
    }

    const parsed = await parseJson(request, unlockSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const valid = await verifyPin(parsed.data.pin, group.pin_hash);
    if (!valid) {
      return unauthorized("Incorrect PIN");
    }

    const signed = await signEditToken({ groupId: group.id });
    return ok({
      token: signed.token,
      expiresAt: signed.expiresAt
    });
  } catch {
    return serverError();
  }
}
