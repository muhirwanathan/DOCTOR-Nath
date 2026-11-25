import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodType } from "zod";
import { config } from "./config.js";
import { db, now } from "./db.js";

export type Role = "LEARNER" | "MENTOR" | "ADMIN";
export interface AuthUser {
  sub: string;
  role: Role;
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const forbidden = (why = "You do not have access to this") => new HttpError(403, why);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new HttpError(400, fields.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; "), { fields });
  }
  return r.data;
}

/** preHandler: requires a valid login, optionally one of the given roles (RBAC, SRS 5.3). */
export function requireAuth(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, "Please log in");
    }
    // Deleted or anonymised accounts lose access at once, even with an unexpired token.
    if (!db().get("SELECT 1 FROM users WHERE id = ? AND password_hash != 'deleted'", req.user.sub)) throw new HttpError(401, "Account no longer exists");
    if (roles.length && !roles.includes(req.user.role)) throw forbidden(`This action needs the ${roles.join(" or ")} role`);
  };
}

/**
 * Replays the stored response when a client retries with the same Idempotency-Key.
 * An offline device that never saw the first response can safely resend.
 */
export async function idempotent<T>(req: FastifyRequest, reply: FastifyReply, fn: () => Promise<T> | T): Promise<T> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key) return fn();
  const scoped = `${req.user.sub}:${key}`;
  const seen = db().get<{ status: number; response: string }>("SELECT status, response FROM idempotency_keys WHERE key = ?", scoped);
  if (seen) {
    reply.header("Idempotent-Replay", "true").code(seen.status);
    return JSON.parse(seen.response) as T;
  }
  const result = await fn();
  db().insert("idempotency_keys", { key: scoped, user_id: req.user.sub, status: reply.statusCode, response: JSON.stringify(result ?? null), created_at: now() });
  return result;
}

// Short-lived signed URLs for uploaded files: least-privilege storage access (Figure 11a).
const sig = (subId: string, exp: number) => createHmac("sha256", config.jwtSecret).update(`${subId}.${exp}`).digest("base64url");

export function signedFileUrl(submissionId: string, ttlSeconds = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${submissionId}?exp=${exp}&sig=${sig(submissionId, exp)}`;
}

export function checkFileSignature(submissionId: string, exp: number, signature: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(sig(submissionId, exp));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Language = z.enum(["en", "rw"]);
export const Theme = z.enum(["AGRICULTURE", "HEALTH", "EDUCATION", "ICT"]);
