import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, id, json, now } from "../db.js";
import { HttpError, Language, parse, requireAuth } from "../http.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { assignSubmission } from "../services/assign.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: "LEARNER" | "MENTOR" | "ADMIN";
  language: string;
  skills: string;
  expertise: string;
  capacity: number;
  portfolio_public: number;
  portfolio_slug: string | null;
}

export const publicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  language: u.language,
  skills: json<string[]>(u.skills, []),
  expertise: json<string[]>(u.expertise, []),
  capacity: u.capacity,
  portfolioPublic: !!u.portfolio_public,
  portfolioSlug: u.portfolio_slug,
});

// Brute-force protection: 5 failed logins for the same account from one address locks it for 15 minutes.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const loginFailures = new Map<string, { count: number; first: number }>();

function loginLockedFor(key: string): number {
  const f = loginFailures.get(key);
  if (!f) return 0;
  const left = f.first + LOCK_MS - Date.now();
  if (left <= 0) {
    loginFailures.delete(key);
    return 0;
  }
  return f.count >= MAX_FAILURES ? left : 0;
}

function recordLoginFailure(key: string) {
  const f = loginFailures.get(key);
  if (!f || f.first + LOCK_MS < Date.now()) loginFailures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

const slugify = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30)}-${randomBytes(3).toString("hex")}`;

const Register = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{9,15}$/, "use digits, e.g. +250788123456")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  password: z.string().min(8, "at least 8 characters").max(200),
  role: z.enum(["LEARNER", "MENTOR"]),
  language: Language.default("en"),
});

export default async function authRoutes(app: FastifyInstance) {
  const sign = (u: UserRow) => app.jwt.sign({ sub: u.id, role: u.role, name: u.name }, { expiresIn: "7d" });

  app.post("/api/auth/register", async (req, reply) => {
    const body = parse(Register, req.body);
    const d = db();
    if (d.get("SELECT 1 FROM users WHERE email = ?", body.email)) throw new HttpError(409, "An account with this email already exists");
    const userId = id();
    d.tx(() => {
      d.insert("users", {
        id: userId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        password_hash: hashPassword(body.password),
        role: body.role,
        language: body.language,
        portfolio_slug: slugify(body.name),
        created_at: now(),
      });
      audit(userId, "user.registered", "user", userId, { role: body.role });
    });
    const user = d.get<UserRow>("SELECT * FROM users WHERE id = ?", userId)!;
    reply.code(201);
    return { token: sign(user), user: publicUser(user) };
  });

  app.post("/api/auth/login", async (req) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const key = `${req.ip}|${body.email}`;
    const wait = loginLockedFor(key);
    if (wait) throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60_000)} minute(s), or reset your password.`);
    const user = db().get<UserRow>("SELECT * FROM users WHERE email = ? OR phone = ?", body.email, body.email);
    // Same message for unknown email and wrong password, so accounts cannot be probed.
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      recordLoginFailure(key);
      throw new HttpError(401, "Email/phone or password is incorrect");
    }
    loginFailures.delete(key);
    return { token: sign(user), user: publicUser(user) };
  });

  app.post("/api/auth/forgot", async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase() }), req.body);
    const user = db().get<UserRow>("SELECT * FROM users WHERE email = ? OR phone = ?", email, email);
    if (user) {
      const token = randomBytes(24).toString("base64url");
      db().tx(() => {
        db().insert("password_resets", {
          token_hash: createHash("sha256").update(token).digest("hex"),
          user_id: user.id,
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
        notify(user.id, "Reset your Dr. Nath password", `Your reset code is ${token}. It expires in 30 minutes.`, user.phone ? ["EMAIL", "SMS"] : ["EMAIL"]);
      });
    }
    return { ok: true, message: "If that account exists, a reset code has been sent." };
  });

  app.post("/api/auth/reset", async (req) => {
    const body = parse(z.object({ token: z.string().min(10), password: z.string().min(8).max(200) }), req.body);
    const d = db();
    const hash = createHash("sha256").update(body.token).digest("hex");
    const row = d.get<{ user_id: string; expires_at: string; used: number }>("SELECT * FROM password_resets WHERE token_hash = ?", hash);
    if (!row || row.used || row.expires_at < now()) throw new HttpError(400, "This reset code is invalid or has expired");
    d.tx(() => {
      d.run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(body.password), row.user_id);
      d.run("UPDATE password_resets SET used = 1 WHERE token_hash = ?", hash);
      audit(row.user_id, "user.password_reset", "user", row.user_id);
    });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireAuth() }, async (req) => publicUser(db().get<UserRow>("SELECT * FROM users WHERE id = ?", req.user.sub)!));

  app.patch("/api/me", { preHandler: requireAuth() }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        language: Language.optional(),
        skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        expertise: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        portfolioPublic: z.boolean().optional(),
      }),
      req.body,
    );
    const d = db();
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (body.name) sets.push("name = ?"), vals.push(body.name);
    if (body.language) sets.push("language = ?"), vals.push(body.language);
    if (body.skills) sets.push("skills = ?"), vals.push(JSON.stringify(body.skills));
    if (body.expertise && req.user.role === "MENTOR") sets.push("expertise = ?"), vals.push(JSON.stringify(body.expertise));
    if (body.portfolioPublic !== undefined) sets.push("portfolio_public = ?"), vals.push(body.portfolioPublic ? 1 : 0);
    if (sets.length) {
      d.tx(() => {
        d.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...vals, req.user.sub);
        audit(req.user.sub, "user.updated", "user", req.user.sub, { fields: Object.keys(body) });
      });
    }
    return publicUser(d.get<UserRow>("SELECT * FROM users WHERE id = ?", req.user.sub)!);
  });

  // NFR4: users can delete their account and data (Law No 058/2021).
  app.delete("/api/me", { preHandler: requireAuth() }, async (req) => {
    const d = db();
    const uid = req.user.sub;
    const authored =
      d.get("SELECT 1 FROM feedback WHERE mentor_id = ?", uid) ||
      d.get("SELECT 1 FROM assignments WHERE mentor_id = ?", uid) ||
      d.get("SELECT 1 FROM challenges WHERE created_by = ?", uid);
    d.tx(() => {
      d.run("DELETE FROM idempotency_keys WHERE user_id = ?", uid); // cached responses can hold submission text
      if (authored) {
        // Feedback and challenges belong to other people's records, so a mentor or admin
        // account is anonymised: every personal field is erased, the authored work stays.
        const pending = d.all<{ id: string; submission_id: string }>("SELECT id, submission_id FROM assignments WHERE mentor_id = ? AND status = 'ACTIVE'", uid);
        d.run("UPDATE assignments SET status = 'REASSIGNED' WHERE mentor_id = ? AND status = 'ACTIVE'", uid);
        d.run(
          `UPDATE users SET name = 'Deleted user', email = ?, phone = NULL, password_hash = 'deleted', skills = '[]', expertise = '[]',
           capacity = 0, portfolio_public = 0, portfolio_slug = NULL, role = CASE role WHEN 'ADMIN' THEN 'ADMIN' ELSE 'MENTOR' END WHERE id = ?`,
          `deleted-${uid}@invalid`,
          uid,
        );
        d.run("DELETE FROM notifications WHERE user_id = ?", uid);
        for (const a of pending) assignSubmission(a.submission_id, new Set([uid]));
      } else {
        // Learners: enrolments, submissions, feedback on them, drafts, badges and surveys cascade.
        d.run("DELETE FROM users WHERE id = ?", uid);
      }
      audit(null, authored ? "user.anonymised" : "user.deleted", "user", uid, {});
    });
    return { ok: true };
  });
}
