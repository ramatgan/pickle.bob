import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const secretValue = process.env.JWT_SECRET;

if (!secretValue) {
  throw new Error("JWT_SECRET is required");
}

const secret = new TextEncoder().encode(secretValue);
const issuer = "pickleball-matchmaker";
const audience = "group-editor";

export async function hashPin(pin: string) {
  return bcrypt.hash(pin, 12);
}

export async function verifyPin(pin: string, hash: string) {
  return bcrypt.compare(pin, hash);
}

export async function signEditToken({
  groupId,
  ttlSeconds = 60 * 60 * 24 * 7
}: {
  groupId: string;
  ttlSeconds?: number;
}) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;

  const token = await new SignJWT({ group_id: groupId, role: "editor" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);

  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export async function verifyEditToken(token: string) {
  const verified = await jwtVerify(token, secret, { issuer, audience });
  const payload = verified.payload as { group_id?: string; role?: string };

  if (!payload.group_id || payload.role !== "editor") {
    throw new Error("Invalid token claims");
  }

  return payload.group_id;
}

export function getBearerToken(header: string | null) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}
