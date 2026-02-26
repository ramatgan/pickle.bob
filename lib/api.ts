import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getBearerToken, verifyEditToken } from "@/lib/auth";

export async function parseJson<T>(request: NextRequest, schema: ZodSchema<T>) {
  try {
    const payload = await request.json();
    return { ok: true as const, data: schema.parse(payload) };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false as const,
        response: badRequest("Invalid request body", error.flatten())
      };
    }

    return { ok: false as const, response: badRequest("Invalid JSON") };
  }
}

export async function requireEditor(request: NextRequest, groupId: string) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return { ok: false as const, response: unauthorized("Missing editor token") };
  }

  try {
    const tokenGroupId = await verifyEditToken(token);
    if (tokenGroupId !== groupId) {
      return { ok: false as const, response: forbidden("Token group mismatch") };
    }

    return { ok: true as const };
  } catch {
    return { ok: false as const, response: unauthorized("Invalid editor token") };
  }
}

export function ok(data: unknown) {
  return NextResponse.json(data, { status: 200 });
}

export function created(data: unknown) {
  return NextResponse.json(data, { status: 201 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function serverError(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}
