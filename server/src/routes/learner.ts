import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { db, id, json, now } from "../db.js";
import { HttpError, notFound, parse, requireAuth } from "../http.js";
import { calibrate } from "../lib/calibration.js";
import { didDocument, verifyCredential } from "../lib/credentials.js";
import { recommend, skillMastery, type ChallengeNode, type LearnerState } from "../lib/recommend.js";
import { ratingCalibration } from "../services/analytics.js";
import { audit } from "../services/audit.js";
import { issuerDid, issuerKeys } from "../services/issuer.js";

export const SURVEY_QUESTIONS = [
  "I can break a messy real-world problem into smaller parts.",
  "I can come up with more than one creative solution to a problem.",
  "I can test whether my solution actually works.",
  "I can explain my solution clearly to others.",
  "I am confident I could solve a real problem for a community or employer.",
];

function challengeGraph(): ChallengeNode[] {
  return db()
    .all<{ id: string; title: string; theme: string; skills: string; difficulty: number; prerequisites: string }>("SELECT * FROM challenges WHERE status = 'LIVE'")
    .map((c) => ({ id: c.id, title: c.title, theme: c.theme, skills: json(c.skills, []), difficulty: c.difficulty, prerequisites: json(c.prerequisites, []) }));
}

function learnerState(userId: string): LearnerState {
  const d = db();
  const model = ratingCalibration();
  const evidence = d
    .all<{ challenge_id: string; rating: number; mentor_id: string; created_at: string }>(
      `SELECT st.challenge_id, f.rating, f.mentor_id, f.created_at FROM submissions s JOIN feedback f ON f.submission_id = s.id
       JOIN stages st ON st.id = s.stage_id WHERE s.user_id = ? AND s.status = 'APPROVED'`,
      userId,
    )
    .map((e) => ({ challengeId: e.challenge_id, calibratedRating: calibrate(model, e.mentor_id, e.rating), approvedAt: e.created_at }));
  const enrol = d.all<{ challenge_id: string; status: string }>("SELECT challenge_id, status FROM enrolments WHERE user_id = ?", userId);
  const user = d.get<{ skills: string }>("SELECT skills FROM users WHERE id = ?", userId)!;
  return {
    declaredSkills: json(user.skills, []),
    evidence,
    completed: new Set(enrol.filter((e) => e.status === "COMPLETED").map((e) => e.challenge_id)),
    enrolled: new Set(enrol.filter((e) => e.status === "ACTIVE").map((e) => e.challenge_id)),
  };
}

function portfolio(userId: string) {
  const d = db();
  const user = d.get<{ name: string; skills: string; portfolio_public: number; portfolio_slug: string }>("SELECT name, skills, portfolio_public, portfolio_slug FROM users WHERE id = ?", userId)!;
  const model = ratingCalibration();
  const projects = d
    .all<{ challenge_id: string; title: string; theme: string; completed_at: string }>(
      "SELECT e.challenge_id, c.title, c.theme, e.completed_at FROM enrolments e JOIN challenges c ON c.id = e.challenge_id WHERE e.user_id = ? AND e.status = 'COMPLETED' ORDER BY e.completed_at DESC",
      userId,
    )
    .map((p) => {
      const ratings = d.all<{ rating: number; mentor_id: string }>(
        "SELECT f.rating, f.mentor_id FROM feedback f JOIN submissions s ON s.id = f.submission_id JOIN stages st ON st.id = s.stage_id WHERE s.user_id = ? AND st.challenge_id = ? AND s.status = 'APPROVED'",
        userId,
        p.challenge_id,
      );
      const avg = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null;
      const cal = ratings.length ? ratings.reduce((s, r) => s + calibrate(model, r.mentor_id, r.rating), 0) / ratings.length : null;
      return { title: p.title, theme: p.theme, completedAt: p.completed_at, mentorRating: avg, calibratedRating: cal };
    });
  const badges = d
    .all<{ id: string; badge_name: string; milestone: string; issued_at: string }>("SELECT id, badge_name, milestone, issued_at FROM credentials WHERE user_id = ? AND revoked = 0 ORDER BY issued_at", userId)
    .map((b) => ({ id: b.id, name: b.badge_name, milestone: b.milestone, issuedAt: b.issued_at, verifyUrl: `${config.publicUrl}/verify/${b.id}` }));
  const mastery = [...skillMastery(learnerState(userId), new Map(challengeGraph().map((c) => [c.id, c])), Date.now())]
    .map(([skill, level]) => ({ skill, level }))
    .sort((a, b) => b.level - a.level)
    .slice(0, 8);
  return { name: user.name, public: !!user.portfolio_public, slug: user.portfolio_slug, publicUrl: `${config.publicUrl}/p/${user.portfolio_slug}`, projects, badges, skills: mastery };
}

function verifyStored(credentialId: string) {
  const c = db().get<{ jwt: string; revoked: number }>("SELECT jwt, revoked FROM credentials WHERE id = ?", credentialId);
  if (!c) return null;
  const result = verifyCredential(c.jwt, issuerKeys().publicKey);
  return { jwt: c.jwt, revoked: !!c.revoked, ...result };
}

export default async function learnerRoutes(app: FastifyInstance) {
  app.get("/api/recommendations", { preHandler: requireAuth("LEARNER") }, async (req) => {
    const peers = db()
      .all<{ user_id: string; challenge_id: string }>("SELECT user_id, challenge_id FROM enrolments WHERE status = 'COMPLETED' AND user_id != ?", req.user.sub)
      .reduce((m, r) => m.set(r.user_id, (m.get(r.user_id) ?? new Set<string>()).add(r.challenge_id)), new Map<string, Set<string>>());
    return recommend(learnerState(req.user.sub), challengeGraph(), [...peers.values()], Date.now(), 3);
  });

  app.get("/api/portfolio", { preHandler: requireAuth("LEARNER") }, async (req) => portfolio(req.user.sub));

  // Private by default; visible only once the learner shares it (SRS 5.5).
  app.get("/api/public/portfolio/:slug", async (req) => {
    const u = db().get<{ id: string }>("SELECT id FROM users WHERE portfolio_slug = ? AND portfolio_public = 1", (req.params as { slug: string }).slug);
    if (!u) throw notFound("This portfolio is private or does not exist");
    const { public: _p, slug: _s, ...rest } = portfolio(u.id);
    return rest;
  });

  app.get("/api/public/credentials/:id", async (req) => {
    const r = verifyStored((req.params as { id: string }).id);
    if (!r) throw notFound("No credential with this ID");
    return { ...r, issuer: { did: issuerDid(), didDocument: `${config.publicUrl}/.well-known/did.json` } };
  });

  // Verify any credential JWT someone pastes in, without trusting our database.
  app.post("/api/public/verify", async (req) => {
    const { jwt } = parse(z.object({ jwt: z.string().min(20).max(20_000) }), req.body);
    return verifyCredential(jwt.trim(), issuerKeys().publicKey);
  });

  app.get("/.well-known/did.json", async () => didDocument(issuerDid(), issuerKeys()));

  app.get("/api/surveys", { preHandler: requireAuth("LEARNER") }, async (req) => {
    const d = db();
    const done = d.all<{ type: string; confidence_score: number; submitted_at: string }>("SELECT type, confidence_score, submitted_at FROM survey_responses WHERE user_id = ?", req.user.sub);
    const pre = done.find((r) => r.type === "PRE");
    const completed = d.get<{ n: number }>("SELECT COUNT(*) n FROM enrolments WHERE user_id = ? AND status = 'COMPLETED'", req.user.sub)!.n;
    const sixMonths = pre && Date.now() - Date.parse(pre.submitted_at) > 182 * 86_400_000;
    return {
      questions: SURVEY_QUESTIONS,
      done: done.map((r) => ({ type: r.type, confidence: r.confidence_score, submittedAt: r.submitted_at })),
      postAvailable: !!pre && !done.some((r) => r.type === "POST") && (completed > 0 || !!sixMonths),
    };
  });

  app.post("/api/surveys", { preHandler: requireAuth("LEARNER") }, async (req, reply) => {
    const body = parse(z.object({ type: z.enum(["PRE", "POST"]), answers: z.array(z.number().int().min(1).max(5)).length(SURVEY_QUESTIONS.length) }), req.body);
    const d = db();
    if (d.get("SELECT 1 FROM survey_responses WHERE user_id = ? AND type = ?", req.user.sub, body.type)) throw new HttpError(409, "You have already taken this survey");
    if (body.type === "POST" && !d.get("SELECT 1 FROM survey_responses WHERE user_id = ? AND type = 'PRE'", req.user.sub)) throw new HttpError(409, "Take the pre-programme survey first");
    const confidence = body.answers.reduce((a, b) => a + b, 0) / body.answers.length;
    d.tx(() => {
      const sid = id();
      d.insert("survey_responses", { id: sid, user_id: req.user.sub, type: body.type, confidence_score: confidence, answers: JSON.stringify(body.answers), submitted_at: now() });
      audit(req.user.sub, "survey.submitted", "survey", sid, { type: body.type });
    });
    reply.code(201);
    return { confidence };
  });

  app.get("/api/notifications", { preHandler: requireAuth() }, async (req) =>
    db()
      .all<{ id: string; subject: string; message: string; is_read: number; created_at: string }>(
        "SELECT id, subject, message, is_read, created_at FROM notifications WHERE user_id = ? AND channel = 'IN_APP' ORDER BY created_at DESC LIMIT 30",
        req.user.sub,
      )
      .map((n) => ({ id: n.id, subject: n.subject, message: n.message, read: !!n.is_read, createdAt: n.created_at })),
  );

  app.post("/api/notifications/read-all", { preHandler: requireAuth() }, async (req) => {
    db().run("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND channel = 'IN_APP'", req.user.sub);
    return { ok: true };
  });
}
