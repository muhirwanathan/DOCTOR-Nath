import { config } from "../config.js";
import { db, id, json, now } from "../db.js";
import { chooseMentor, slaState, type MentorCandidate } from "../lib/matching.js";
import { audit } from "./audit.js";
import { notify, notifyAdmins } from "./notify.js";

const DAY = 86_400_000;

function median(xs: number[]) {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
}

function mentorCandidates(learnerId: string, stageId: string): MentorCandidate[] {
  const d = db();
  const mentors = d.all<{ id: string; expertise: string; language: string; capacity: number }>(
    "SELECT id, expertise, language, capacity FROM users WHERE role = 'MENTOR'",
  );
  return mentors.map((m) => {
    const load = d.get<{ n: number }>("SELECT COUNT(*) n FROM assignments WHERE mentor_id = ? AND status = 'ACTIVE'", m.id)!.n;
    const done = d.all<{ assigned_at: string; created_at: string }>(
      `SELECT a.assigned_at, f.created_at FROM assignments a JOIN feedback f ON f.submission_id = a.submission_id AND f.mentor_id = a.mentor_id
       WHERE a.mentor_id = ? AND a.status = 'DONE' ORDER BY f.created_at DESC LIMIT 20`,
      m.id,
    );
    const prev = d.get<{ n: number }>(
      "SELECT COUNT(*) n FROM feedback f JOIN submissions s ON s.id = f.submission_id WHERE f.mentor_id = ? AND s.user_id = ? AND s.stage_id = ?",
      m.id,
      learnerId,
      stageId,
    )!.n;
    return {
      id: m.id,
      expertise: json<string[]>(m.expertise, []),
      language: m.language,
      capacity: m.capacity,
      activeLoad: load,
      medianTurnaroundDays: median(done.map((r) => (Date.parse(r.created_at) - Date.parse(r.assigned_at)) / DAY)),
      reviewedPreviousVersion: prev > 0,
    };
  });
}

/** Assigns a submission to the best mentor. Must run inside a transaction. */
export function assignSubmission(submissionId: string, exclude: Set<string> = new Set()) {
  const d = db();
  const s = d.get<{ user_id: string; stage_id: string; language: string; theme: string; skills: string; title: string }>(
    `SELECT s.user_id, s.stage_id, u.language, c.theme, c.skills, c.title FROM submissions s
     JOIN users u ON u.id = s.user_id JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id
     WHERE s.id = ?`,
    submissionId,
  );
  if (!s) throw new Error(`submission ${submissionId} not found`);
  const pick = chooseMentor(mentorCandidates(s.user_id, s.stage_id), {
    learnerId: s.user_id,
    learnerLanguage: s.language,
    theme: s.theme,
    skills: json<string[]>(s.skills, []),
    slaDays: config.feedbackSlaDays,
    exclude,
  });
  if (!pick) {
    audit(null, "assignment.unassigned", "submission", submissionId, { reason: "no eligible mentor" });
    notifyAdmins("Submission waiting for a mentor", `No eligible mentor for a submission to "${s.title}". Add or free up a mentor.`);
    return null;
  }
  const assignedAt = now();
  const dueAt = new Date(Date.parse(assignedAt) + config.feedbackSlaDays * DAY).toISOString();
  const assignmentId = id();
  d.insert("assignments", {
    id: assignmentId,
    submission_id: submissionId,
    mentor_id: pick.mentorId,
    assigned_at: assignedAt,
    due_at: dueAt,
    status: "ACTIVE",
    score: pick.score,
    reason: JSON.stringify({ factors: pick.factors, overCapacity: pick.overCapacity }),
  });
  audit(null, "assignment.created", "submission", submissionId, { mentorId: pick.mentorId, score: Number(pick.score.toFixed(3)), factors: pick.factors });
  notify(pick.mentorId, "New submission to review", `A new submission for "${s.title}" is in your queue. Please review it within ${config.feedbackSlaDays} days.`);
  return { assignmentId, mentorId: pick.mentorId, score: pick.score, factors: pick.factors };
}

/**
 * SLA monitor: warns mentors when an assignment is at risk, and on breach
 * reassigns it to the next best mentor (never the one who missed it) and alerts admins.
 */
export function checkSlas(nowMs = Date.now()) {
  const d = db();
  const active = d.all<{ id: string; submission_id: string; mentor_id: string; assigned_at: string; due_at: string; warned: number }>(
    "SELECT id, submission_id, mentor_id, assigned_at, due_at, warned FROM assignments WHERE status = 'ACTIVE'",
  );
  let warned = 0;
  let reassigned = 0;
  for (const a of active) {
    const state = slaState(a.assigned_at, a.due_at, nowMs, config.slaWarnFraction);
    if (state === "AT_RISK" && !a.warned) {
      d.tx(() => {
        d.run("UPDATE assignments SET warned = 1 WHERE id = ?", a.id);
        notify(a.mentor_id, "Feedback due soon", `A submission in your queue is due by ${a.due_at.slice(0, 10)}. Learners are waiting on your review.`);
      });
      warned++;
    }
    if (state === "BREACHED") {
      d.tx(() => {
        d.run("UPDATE assignments SET status = 'REASSIGNED' WHERE id = ?", a.id);
        const previous = d.all<{ mentor_id: string }>("SELECT mentor_id FROM assignments WHERE submission_id = ?", a.submission_id);
        audit(null, "assignment.sla_breached", "submission", a.submission_id, { mentorId: a.mentor_id, dueAt: a.due_at });
        const next = assignSubmission(a.submission_id, new Set(previous.map((p) => p.mentor_id)));
        notifyAdmins("Feedback SLA missed", `A review was not done by ${a.due_at.slice(0, 10)}. ${next ? "It has been reassigned." : "No other mentor is available."}`);
      });
      reassigned++;
    }
  }
  return { checked: active.length, warned, reassigned };
}
