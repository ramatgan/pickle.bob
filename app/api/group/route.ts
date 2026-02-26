import { NextRequest } from "next/server";
import { badRequest, conflict, created, parseJson, serverError } from "@/lib/api";
import { hashPin } from "@/lib/auth";
import { createGroup } from "@/lib/repository";
import { createGroupSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const parsed = await parseJson(request, createGroupSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const pinHash = await hashPin(parsed.data.pin);
    const baseSlugInput = parsed.data.slug?.trim() || parsed.data.name;
    const baseSlug = slugify(baseSlugInput);
    if (baseSlug.length < 2) {
      return badRequest("Could not generate a valid slug");
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidateSlug = suffixSlug(baseSlug, attempt);
      try {
        const group = await createGroup({
          name: parsed.data.name,
          slug: candidateSlug,
          pinHash
        });

        return created({
          group,
          groupUrl: `/g/${group.slug}`
        });
      } catch (error) {
        if (isDuplicateSlugError(error)) {
          continue;
        }

        throw error;
      }
    }

    return conflict("Could not allocate a unique slug");
  } catch (error) {
    if (isDuplicateSlugError(error)) {
      return conflict("Group slug already exists");
    }

    return serverError();
  }
}

function isDuplicateSlugError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("duplicate") || message.includes("groups_slug_key");
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (slug.length === 0) {
    return "group";
  }

  return slug.slice(0, 80);
}

function suffixSlug(base: string, attempt: number) {
  if (attempt === 0) {
    return base;
  }

  const suffix = `-${attempt + 1}`;
  const maxBaseLength = Math.max(2, 80 - suffix.length);
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, "");
  return `${trimmedBase}${suffix}`;
}
