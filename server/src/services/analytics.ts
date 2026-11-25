import { config } from "../config.js";
import { db } from "../db.js";
import { fitCalibration } from "../lib/calibration.js";
import { slaState } from "../lib/matching.js";
import { mean, pairedTTest, proportionVsTarget } from "../lib/stats.js";

const DAY = 86_400_000;
const count = (sql: string, ...p: string[]) => db().get<{ n: number }>(sql, ...p)!.n;

export function ratingCalibration() {
  return fitCalibration(db().all<{ mentorId: string; rating: number }>("SELECT mentor_id mentorId, rating FROM feedback"));
}

export function dashboard(nowMs = Date.now()) {
  const d = db();

  // H1: >= 60% of active learners complete at least one project.
  const active = count("SELECT COUNT(DISTINCT user_id) n FROM enrolments");
  const completers = count("SELECT COUNT(DISTINCT user_id) n FROM enrolments WHERE status = 'COMPLETED'");
  const h1 = proportionVsTarget(completers, active, 0.6);

  // H2: >= 70% report higher confidence (paired pre/post survey).
  const pairs = d.all<{ pre: number; post: number }>(
    `SELECT a.confidence_score pre, b.confidence_score post FROM survey_responses a
     JOIN survey_responses b ON b.user_id = a.user_id AND b.type = 'POST' WHERE a.type = 'PRE'`,
  );
  const test = pairedTTest(
    pairs.map((p) => p.pre),
    pairs.map((p) => p.post),
  );
  const improved = pairs.filter((p) => p.post > p.pre).length;
  const h2 = { ...proportionVsTarget(improved, pairs.length, 0.7), test };

  // Success measure: mentor feedback within 5 days for 80% of submissions.
  const turnaround = d.all<{ days: number }>(
    `SELECT (julianday(f.created_at) - julianday(s.submitted_at)) days FROM feedback f JOIN submissions s ON s.id = f.submission_id`,
  );
  const withinSla = turnaround.filter((t) => t.days <= config.feedbackSlaDays).length;
  const sortedDays = turnaround.map((t) => t.days).sort((a, b) => a - b);
  const feedbackSla = {
    ...proportionVsTarget(withinSla, turnaround.length, 0.8),
    medianDays: sortedDays.length ? sortedDays[Math.floor(sortedDays.length / 2)]! : null,
  };

  const funnel = [
    { step: "Registered learners", n: count("SELECT COUNT(*) n FROM users WHERE role = 'LEARNER'") },
    { step: "Took pre-survey", n: count("SELECT COUNT(*) n FROM survey_responses WHERE type = 'PRE'") },
    { step: "Enrolled", n: active },
    { step: "Submitted work", n: count("SELECT COUNT(DISTINCT user_id) n FROM submissions") },
    { step: "Stage approved", n: count("SELECT COUNT(DISTINCT user_id) n FROM submissions WHERE status = 'APPROVED'") },
    { step: "Completed a challenge", n: completers },
    { step: "Took post-survey", n: count("SELECT COUNT(*) n FROM survey_responses WHERE type = 'POST'") },
  ];

  const model = ratingCalibration();
  const mentors = d.all<{ id: string; name: string; capacity: number }>("SELECT id, name, capacity FROM users WHERE role = 'MENTOR' ORDER BY name").map((m) => {
    const cal = model.mentors.get(m.id);
    const days = d
      .all<{ days: number }>(
        `SELECT (julianday(f.created_at) - julianday(a.assigned_at)) days FROM assignments a
         JOIN feedback f ON f.submission_id = a.submission_id AND f.mentor_id = a.mentor_id WHERE a.mentor_id = ?`,
        m.id,
      )
      .map((r) => r.days);
    return {
      id: m.id,
      name: m.name,
      reviews: cal?.n ?? 0,
      meanRating: cal?.mean ?? null,
      bias: cal?.bias ?? 0,
      label: cal?.label ?? "TYPICAL",
      activeLoad: count("SELECT COUNT(*) n FROM assignments WHERE mentor_id = ? AND status = 'ACTIVE'", m.id),
      capacity: m.capacity,
      meanTurnaroundDays: days.length ? mean(days) : null,
    };
  });

  const sla = d
    .all<{ id: string; assigned_at: string; due_at: string; mentor: string; learner: string; challenge: string; stage: string }>(
      `SELECT a.id, a.assigned_at, a.due_at, m.name mentor, u.name learner, c.title challenge, st.title stage
       FROM assignments a JOIN users m ON m.id = a.mentor_id JOIN submissions s ON s.id = a.submission_id
       JOIN users u ON u.id = s.user_id JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id
       WHERE a.status = 'ACTIVE' ORDER BY a.due_at`,
    )
    .map((a) => ({ ...a, state: slaState(a.assigned_at, a.due_at, nowMs, config.slaWarnFraction), daysLeft: (Date.parse(a.due_at) - nowMs) / DAY }));

  const totalFeedback = count("SELECT COUNT(*) n FROM feedback");
  return {
    generatedAt: new Date(nowMs).toISOString(),
    hypotheses: { completion: h1, confidence: h2 },
    feedbackSla,
    funnel,
    calibration: { globalMean: model.globalMean, shrinkage: model.shrinkage, mentors },
    sla,
    aiAssistedShare: totalFeedback ? count("SELECT COUNT(*) n FROM feedback WHERE ai_assisted = 1") / totalFeedback : 0,
    reassignments: count("SELECT COUNT(*) n FROM assignments WHERE status = 'REASSIGNED'"),
  };
}
