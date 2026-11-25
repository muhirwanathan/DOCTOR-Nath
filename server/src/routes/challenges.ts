import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, id, json, now } from "../db.js";
import { HttpError, notFound, parse, requireAuth, Theme } from "../http.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";

interface ChallengeRow {
  id: string;
  title: string;
  brief: string;
  theme: string;
  difficulty: number;
  duration_weeks: number;
  status: string;
  skills: string;
  prerequisites: string;
}

export const challengeDto = (c: ChallengeRow) => ({
  id: c.id,
  title: c.title,
  brief: c.brief,
  theme: c.theme,
  difficulty: c.difficulty,
  durationWeeks: c.duration_weeks,
  status: c.status,
  skills: json<string[]>(c.skills, []),
  prerequisites: json<string[]>(c.prerequisites, []),
});

const ChallengeInput = z.object({
  title: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(10).max(4000),
  theme: Theme,
  difficulty: z.number().int().min(1).max(5),
  durationWeeks: z.number().int().min(1).max(26),
  skills: z.array(z.string().trim().min(1).max(40)).max(10),
  prerequisites: z.array(z.string()).max(5).default([]),
  status: z.enum(["DRAFT", "LIVE"]).default("DRAFT"),
  stages: z
    .array(z.object({ title: z.string().trim().min(2).max(120), brief: z.string().trim().min(5).max(4000), criteria: z.string().trim().min(5).max(2000) }))
    .min(1)
    .max(10),
});

export default async function challengeRoutes(app: FastifyInstance) {
  app.get("/api/challenges", { preHandler: requireAuth() }, async (req) => {
    const q = parse(z.object({ theme: Theme.optional(), q: z.string().max(100).optional() }), req.query);
    const isAdmin = req.user.role === "ADMIN";
    const where = [isAdmin ? "c.status != 'ARCHIVED'" : "c.status = 'LIVE'"];
    const params: string[] = [];
    if (q.theme) where.push("c.theme = ?"), params.push(q.theme);
    if (q.q) where.push("(c.title LIKE ? OR c.brief LIKE ?)"), params.push(`%${q.q}%`, `%${q.q}%`);
    const rows = db().all<ChallengeRow & { stage_count: number; enrolment_status: string | null; progress_pct: number | null }>(
      `SELECT c.*, (SELECT COUNT(*) FROM stages s WHERE s.challenge_id = c.id) stage_count, e.status enrolment_status, e.progress_pct
       FROM challenges c LEFT JOIN enrolments e ON e.challenge_id = c.id AND e.user_id = ?
       WHERE ${where.join(" AND ")} ORDER BY c.difficulty, c.title`,
      req.user.sub,
      ...params,
    );
    const completed = new Set(db().all<{ challenge_id: string }>("SELECT challenge_id FROM enrolments WHERE user_id = ? AND status = 'COMPLETED'", req.user.sub).map((r) => r.challenge_id));
    return rows.map((r) => {
      const dto = challengeDto(r);
      return { ...dto, stageCount: r.stage_count, enrolment: r.enrolment_status ? { status: r.enrolment_status, progressPct: r.progress_pct } : null, locked: dto.prerequisites.some((p) => !completed.has(p)) };
    });
  });

  app.get("/api/challenges/:id", { preHandler: requireAuth() }, async (req) => {
    const { id: cid } = req.params as { id: string };
    const d = db();
    const c = d.get<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", cid);
    if (!c || (c.status !== "LIVE" && req.user.role !== "ADMIN")) throw notFound("Challenge not found");
    const stages = d.all<{ id: string; sequence: number; title: string; brief: string; criteria: string }>("SELECT * FROM stages WHERE challenge_id = ? ORDER BY sequence", cid);
    const enrolment = d.get<{ id: string; current_stage: number; progress_pct: number; status: string }>("SELECT * FROM enrolments WHERE user_id = ? AND challenge_id = ?", req.user.sub, cid);
    const prereqs = json<string[]>(c.prerequisites, []).map((p) => {
      const pc = d.get<{ title: string }>("SELECT title FROM challenges WHERE id = ?", p);
      const done = !!d.get("SELECT 1 FROM enrolments WHERE user_id = ? AND challenge_id = ? AND status = 'COMPLETED'", req.user.sub, p);
      return { id: p, title: pc?.title ?? p, done };
    });
    return {
      ...challengeDto(c),
      prerequisites: prereqs,
      enrolment: enrolment ? { id: enrolment.id, currentStage: enrolment.current_stage, progressPct: enrolment.progress_pct, status: enrolment.status } : null,
      stages: stages.map((s) => {
        const latest = d.get<{ id: string; status: string; version: number }>(
          "SELECT id, status, version FROM submissions WHERE user_id = ? AND stage_id = ? ORDER BY version DESC LIMIT 1",
          req.user.sub,
          s.id,
        );
        const unlocked = req.user.role !== "LEARNER" || (!!enrolment && s.sequence <= enrolment.current_stage);
        return { id: s.id, sequence: s.sequence, title: s.title, brief: s.brief, criteria: s.criteria, unlocked, latestSubmission: latest ?? null };
      }),
    };
  });

  app.post("/api/challenges/:id/enrol", { preHandler: requireAuth("LEARNER") }, async (req, reply) => {
    const { id: cid } = req.params as { id: string };
    const d = db();
    const c = d.get<ChallengeRow>("SELECT * FROM challenges WHERE id = ? AND status = 'LIVE'", cid);
    if (!c) throw notFound("Challenge not found");
    // Business rule (SRS 5.5): the pre-programme survey comes before the first challenge.
    if (!d.get("SELECT 1 FROM survey_responses WHERE user_id = ? AND type = 'PRE'", req.user.sub)) {
      throw new HttpError(412, "Please complete the short pre-programme survey before your first challenge", { needsSurvey: "PRE" });
    }
    const missing = json<string[]>(c.prerequisites, []).filter((p) => !d.get("SELECT 1 FROM enrolments WHERE user_id = ? AND challenge_id = ? AND status = 'COMPLETED'", req.user.sub, p));
    if (missing.length) throw new HttpError(409, "Complete the prerequisite challenges first", { missing });
    const existing = d.get<{ id: string }>("SELECT id FROM enrolments WHERE user_id = ? AND challenge_id = ?", req.user.sub, cid);
    if (existing) return { id: existing.id, alreadyEnrolled: true };
    const enrolmentId = id();
    d.tx(() => {
      d.insert("enrolments", { id: enrolmentId, user_id: req.user.sub, challenge_id: cid, current_stage: 1, progress_pct: 0, status: "ACTIVE", enrolled_at: now() });
      audit(req.user.sub, "enrolment.created", "enrolment", enrolmentId, { challengeId: cid });
    });
    reply.code(201);
    return { id: enrolmentId, alreadyEnrolled: false };
  });

  app.get("/api/enrolments", { preHandler: requireAuth("LEARNER") }, async (req) =>
    db()
      .all<{ id: string; challenge_id: string; title: string; theme: string; current_stage: number; progress_pct: number; status: string; stage_count: number }>(
        `SELECT e.*, c.title, c.theme, (SELECT COUNT(*) FROM stages s WHERE s.challenge_id = c.id) stage_count
         FROM enrolments e JOIN challenges c ON c.id = e.challenge_id WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`,
        req.user.sub,
      )
      .map((e) => ({ id: e.id, challengeId: e.challenge_id, title: e.title, theme: e.theme, currentStage: e.current_stage, stageCount: e.stage_count, progressPct: e.progress_pct, status: e.status })),
  );

  // Admin: create / edit / archive challenges (FR9.1).
  app.post("/api/admin/challenges", { preHandler: requireAuth("ADMIN") }, async (req, reply) => {
    const body = parse(ChallengeInput, req.body);
    const d = db();
    const cid = id();
    d.tx(() => {
      d.insert("challenges", {
        id: cid,
        title: body.title,
        brief: body.brief,
        theme: body.theme,
        difficulty: body.difficulty,
        duration_weeks: body.durationWeeks,
        status: body.status,
        skills: JSON.stringify(body.skills),
        prerequisites: JSON.stringify(body.prerequisites),
        created_by: req.user.sub,
        created_at: now(),
      });
      body.stages.forEach((s, i) => d.insert("stages", { id: id(), challenge_id: cid, sequence: i + 1, ...s }));
      audit(req.user.sub, "challenge.created", "challenge", cid, { title: body.title, status: body.status });
      if (body.status === "LIVE") announce(body.title);
    });
    reply.code(201);
    return { id: cid };
  });

  // FR9.1 edit. Stages are matched by position: existing ones are reworded in place,
  // new ones appended, and trailing ones removed only if no learner has submitted to them.
  app.put("/api/admin/challenges/:id", { preHandler: requireAuth("ADMIN") }, async (req) => {
    const { id: cid } = req.params as { id: string };
    const body = parse(ChallengeInput.omit({ status: true }), req.body);
    const d = db();
    if (!d.get("SELECT 1 FROM challenges WHERE id = ?", cid)) throw notFound("Challenge not found");
    if (body.prerequisites.includes(cid)) throw new HttpError(400, "A challenge cannot be its own prerequisite");
    const existing = d.all<{ id: string; sequence: number }>("SELECT id, sequence FROM stages WHERE challenge_id = ? ORDER BY sequence", cid);
    const removed = existing.slice(body.stages.length);
    for (const s of removed) {
      if (d.get("SELECT 1 FROM submissions WHERE stage_id = ?", s.id)) {
        throw new HttpError(409, `Stage ${s.sequence} already has learner submissions, so it cannot be removed. Edit its text instead.`);
      }
    }
    d.tx(() => {
      d.run(
        "UPDATE challenges SET title = ?, brief = ?, theme = ?, difficulty = ?, duration_weeks = ?, skills = ?, prerequisites = ? WHERE id = ?",
        body.title,
        body.brief,
        body.theme,
        body.difficulty,
        body.durationWeeks,
        JSON.stringify(body.skills),
        JSON.stringify(body.prerequisites),
        cid,
      );
      body.stages.forEach((s, i) => {
        const current = existing[i];
        if (current) d.run("UPDATE stages SET title = ?, brief = ?, criteria = ? WHERE id = ?", s.title, s.brief, s.criteria, current.id);
        else d.insert("stages", { id: id(), challenge_id: cid, sequence: i + 1, ...s });
      });
      for (const s of removed) d.run("DELETE FROM stages WHERE id = ?", s.id);
      if (removed.length) {
        d.run("UPDATE enrolments SET current_stage = MIN(current_stage, ?) WHERE challenge_id = ?", body.stages.length, cid);
      }
      audit(req.user.sub, "challenge.edited", "challenge", cid, { title: body.title, stages: body.stages.length });
    });
    return { ok: true };
  });

  app.patch("/api/admin/challenges/:id", { preHandler: requireAuth("ADMIN") }, async (req) => {
    const { id: cid } = req.params as { id: string };
    const body = parse(z.object({ status: z.enum(["DRAFT", "LIVE", "ARCHIVED"]) }), req.body);
    const d = db();
    const c = d.get<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", cid);
    if (!c) throw notFound("Challenge not found");
    d.tx(() => {
      d.run("UPDATE challenges SET status = ? WHERE id = ?", body.status, cid);
      audit(req.user.sub, "challenge.status_changed", "challenge", cid, { from: c.status, to: body.status });
      if (body.status === "LIVE" && c.status !== "LIVE") announce(c.title);
    });
    return { ok: true };
  });
}

/** FR10.1: tell learners when a new challenge goes live. */
function announce(title: string) {
  for (const l of db().all<{ id: string }>("SELECT id FROM users WHERE role = 'LEARNER'")) {
    notify(l.id, "New challenge", `"${title}" is now open. Take a look in the challenge library.`, ["IN_APP"]);
  }
}
