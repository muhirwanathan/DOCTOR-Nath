import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, json } from "../db.js";
import { notFound, parse, requireAuth } from "../http.js";
import { dashboard } from "../services/analytics.js";
import { checkSlas } from "../services/assign.js";
import { audit, verifyAuditLog } from "../services/audit.js";
import { SURVEY_QUESTIONS } from "./learner.js";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything and neutralise spreadsheet formulas (CSV injection).
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export default async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireAuth("ADMIN") };

  app.get("/api/admin/analytics", admin, async () => dashboard());

  app.get("/api/admin/users", admin, async () =>
    db()
      .all<{ id: string; name: string; email: string; role: string; language: string; expertise: string; capacity: number; created_at: string }>(
        "SELECT id, name, email, role, language, expertise, capacity, created_at FROM users ORDER BY role, name",
      )
      .map((u) => ({ ...u, expertise: json<string[]>(u.expertise, []), createdAt: u.created_at })),
  );

  // FR9.2: manage roles; mentors also get expertise and review capacity used by matching.
  app.patch("/api/admin/users/:id", admin, async (req) => {
    const { id: uid } = req.params as { id: string };
    const body = parse(
      z.object({ role: z.enum(["LEARNER", "MENTOR", "ADMIN"]).optional(), capacity: z.number().int().min(0).max(50).optional(), expertise: z.array(z.string().trim().min(1)).max(30).optional() }),
      req.body,
    );
    const d = db();
    const u = d.get<{ role: string }>("SELECT role FROM users WHERE id = ?", uid);
    if (!u) throw notFound("User not found");
    d.tx(() => {
      if (body.role) d.run("UPDATE users SET role = ? WHERE id = ?", body.role, uid);
      if (body.capacity !== undefined) d.run("UPDATE users SET capacity = ? WHERE id = ?", body.capacity, uid);
      if (body.expertise) d.run("UPDATE users SET expertise = ? WHERE id = ?", JSON.stringify(body.expertise), uid);
      audit(req.user.sub, "user.admin_updated", "user", uid, { ...body, previousRole: u.role });
    });
    return { ok: true };
  });

  app.get("/api/admin/audit", admin, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return {
      verification: verifyAuditLog(),
      entries: db()
        .all<{ seq: number; ts: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; data: string; hash: string; actor: string | null }>(
          "SELECT a.*, u.name actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY seq DESC LIMIT ?",
          q.limit,
        )
        .map((e) => ({ ...e, data: json(e.data, {}) })),
    };
  });

  app.post("/api/admin/sla/check", admin, async () => checkSlas());

  // FR11.2
  app.get("/api/admin/surveys.csv", admin, async (_req, reply) => {
    const rows = db().all<{ user_id: string; name: string; type: string; confidence_score: number; answers: string; submitted_at: string }>(
      "SELECT s.user_id, u.name, s.type, s.confidence_score, s.answers, s.submitted_at FROM survey_responses s JOIN users u ON u.id = s.user_id ORDER BY u.name, s.type DESC",
    );
    const header = ["learner_id", "learner_name", "survey", "confidence_score", ...SURVEY_QUESTIONS.map((_, i) => `q${i + 1}`), "submitted_at"];
    const lines = rows.map((r) => [r.user_id, r.name, r.type, r.confidence_score.toFixed(2), ...json<number[]>(r.answers, []), r.submitted_at].map(csvCell).join(","));
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="dr-nath-surveys.csv"');
    return [header.map(csvCell).join(","), ...lines].join("\r\n");
  });
}
