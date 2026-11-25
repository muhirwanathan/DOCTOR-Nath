import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { db, id, json, now } from "../db.js";
import { forbidden, HttpError, notFound, parse, requireAuth } from "../http.js";
import { slaState } from "../lib/matching.js";
import { AiUnavailableError, draftFeedback } from "../services/ai.js";
import { audit } from "../services/audit.js";
import { applyDecision } from "../services/progress.js";

function activeAssignment(submissionId: string, mentorId: string) {
  return db().get<{ id: string }>("SELECT id FROM assignments WHERE submission_id = ? AND mentor_id = ? AND status = 'ACTIVE'", submissionId, mentorId);
}

export default async function mentorRoutes(app: FastifyInstance) {
  // FR5.1. Learner contact details are never included (SRS 5.2).
  app.get("/api/mentor/queue", { preHandler: requireAuth("MENTOR") }, async (req) => {
    const rows = db().all<{
      assignment_id: string;
      submission_id: string;
      assigned_at: string;
      due_at: string;
      score: number;
      reason: string;
      version: number;
      learner_name: string;
      learner_id: string;
      stage_id: string;
      stage_title: string;
      sequence: number;
      challenge_title: string;
      theme: string;
    }>(
      `SELECT a.id assignment_id, a.submission_id, a.assigned_at, a.due_at, a.score, a.reason, s.version, u.name learner_name, u.id learner_id,
              st.id stage_id, st.title stage_title, st.sequence, c.title challenge_title, c.theme
       FROM assignments a JOIN submissions s ON s.id = a.submission_id JOIN users u ON u.id = s.user_id
       JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id
       WHERE a.mentor_id = ? AND a.status = 'ACTIVE' ORDER BY a.due_at`,
      req.user.sub,
    );
    const nowMs = Date.now();
    return rows.map((r) => ({
      assignmentId: r.assignment_id,
      submissionId: r.submission_id,
      learner: { id: r.learner_id, name: r.learner_name },
      challenge: r.challenge_title,
      theme: r.theme,
      stage: { id: r.stage_id, title: r.stage_title, sequence: r.sequence },
      version: r.version,
      assignedAt: r.assigned_at,
      dueAt: r.due_at,
      sla: slaState(r.assigned_at, r.due_at, nowMs, config.slaWarnFraction),
      match: { score: r.score, ...json<{ factors: Record<string, number> }>(r.reason, { factors: {} }) },
    }));
  });

  app.get("/api/mentor/review/:submissionId", { preHandler: requireAuth("MENTOR", "ADMIN") }, async (req) => {
    const { submissionId } = req.params as { submissionId: string };
    const d = db();
    const s = d.get<{ id: string; user_id: string; stage_id: string; version: number; content: string; status: string; learner: string; stage_title: string; stage_brief: string; criteria: string; challenge_title: string; challenge_brief: string }>(
      `SELECT s.*, u.name learner, st.title stage_title, st.brief stage_brief, st.criteria, c.title challenge_title, c.brief challenge_brief
       FROM submissions s JOIN users u ON u.id = s.user_id JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id WHERE s.id = ?`,
      submissionId,
    );
    if (!s) throw notFound("Submission not found");
    if (req.user.role === "MENTOR" && !d.get("SELECT 1 FROM assignments WHERE submission_id = ? AND mentor_id = ?", submissionId, req.user.sub)) throw forbidden();
    const active = d.get<{ assigned_at: string; due_at: string }>(
      "SELECT assigned_at, due_at FROM assignments WHERE submission_id = ? AND status = 'ACTIVE' ORDER BY assigned_at DESC LIMIT 1",
      submissionId,
    );
    return {
      assignedAt: active?.assigned_at ?? null,
      dueAt: active?.due_at ?? null,
      learnerName: s.learner,
      learnerId: s.user_id,
      challenge: { title: s.challenge_title, brief: s.challenge_brief },
      stage: { id: s.stage_id, title: s.stage_title, brief: s.stage_brief, criteria: s.criteria },
      canReview: !!activeAssignment(submissionId, req.user.sub),
    };
  });

  app.post("/api/submissions/:id/feedback", { preHandler: requireAuth("MENTOR") }, async (req, reply) => {
    const { id: submissionId } = req.params as { id: string };
    const body = parse(
      z.object({
        strengths: z.string().trim().min(10, "please write at least a sentence").max(4000),
        improvements: z.string().trim().min(10, "please write at least a sentence").max(4000),
        rating: z.number().int().min(1).max(5),
        criteriaMet: z.boolean(),
        aiAssisted: z.boolean().default(false),
      }),
      req.body,
    );
    const d = db();
    const s = d.get<{ user_id: string; status: string }>("SELECT user_id, status FROM submissions WHERE id = ?", submissionId);
    if (!s) throw notFound("Submission not found");
    if (s.user_id === req.user.sub) throw forbidden("Mentors cannot review their own submissions");
    const a = activeAssignment(submissionId, req.user.sub);
    if (!a) throw forbidden("This submission is not assigned to you");
    if (s.status !== "SUBMITTED") throw new HttpError(409, "This submission has already been reviewed");
    const result = d.tx(() => {
      d.insert("feedback", { id: id(), submission_id: submissionId, mentor_id: req.user.sub, strengths: body.strengths, improvements: body.improvements, rating: body.rating, criteria_met: body.criteriaMet ? 1 : 0, ai_assisted: body.aiAssisted ? 1 : 0, created_at: now() });
      d.run("UPDATE assignments SET status = 'DONE' WHERE id = ?", a.id);
      audit(req.user.sub, "feedback.given", "submission", submissionId, { rating: body.rating, criteriaMet: body.criteriaMet, aiAssisted: body.aiAssisted });
      return applyDecision(submissionId, body.criteriaMet);
    });
    reply.code(201);
    return result;
  });

  app.post("/api/submissions/:id/ai-draft", { preHandler: requireAuth("MENTOR") }, async (req, reply) => {
    const { id: submissionId } = req.params as { id: string };
    const d = db();
    if (!activeAssignment(submissionId, req.user.sub)) throw forbidden("This submission is not assigned to you");
    const s = d.get<{ user_id: string; stage_id: string; version: number; content: string; stage_title: string; stage_brief: string; criteria: string; challenge_title: string; challenge_brief: string; language: string }>(
      `SELECT s.*, st.title stage_title, st.brief stage_brief, st.criteria, c.title challenge_title, c.brief challenge_brief, u.language
       FROM submissions s JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      submissionId,
    )!;
    const prev = d.get<{ strengths: string; improvements: string }>(
      "SELECT f.strengths, f.improvements FROM feedback f JOIN submissions x ON x.id = f.submission_id WHERE x.user_id = ? AND x.stage_id = ? AND x.version = ?",
      s.user_id,
      s.stage_id,
      s.version - 1,
    );
    try {
      const draft = await draftFeedback({
        challengeTitle: s.challenge_title,
        challengeBrief: s.challenge_brief,
        stageTitle: s.stage_title,
        stageBrief: s.stage_brief,
        criteria: s.criteria,
        submission: s.content,
        version: s.version,
        previousFeedback: prev,
        language: s.language === "rw" ? "rw" : "en",
      });
      audit(req.user.sub, "feedback.ai_drafted", "submission", submissionId, {});
      return draft;
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        reply.code(503);
        return { error: err.message };
      }
      throw err;
    }
  });
}
