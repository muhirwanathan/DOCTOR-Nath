import { config } from "../config.js";
import { db, id, now } from "../db.js";
import { buildCredential, signCredential } from "../lib/credentials.js";
import { audit } from "./audit.js";
import { issuerDid, issuerKeys } from "./issuer.js";
import { notify } from "./notify.js";

// What happens after a mentor's decision (business rules, SRS 5.5):
// approved -> next stage unlocks; last stage -> challenge complete + signed badge.
// changes requested -> learner revises and resubmits.

const MILESTONES = [
  { count: 1, name: "First Project", criteria: "Completed a first challenge with mentor-approved work on every stage." },
  { count: 3, name: "Problem Solver", criteria: "Completed three challenges with mentor-approved work on every stage." },
  { count: 5, name: "Innovator", criteria: "Completed five challenges with mentor-approved work on every stage." },
];

export function issueBadge(userId: string, badgeName: string, milestone: string, criteria: string, submissionId: string | null) {
  const d = db();
  const user = d.get<{ name: string; portfolio_slug: string | null }>("SELECT name, portfolio_slug FROM users WHERE id = ?", userId)!;
  const credentialId = id();
  const issuedAt = now();
  const vc = buildCredential({
    credentialId: `urn:uuid:${credentialId}`,
    issuerDid: issuerDid(),
    issuerName: "Dr. Nath",
    subjectId: `urn:uuid:${userId}`,
    subjectName: user.name,
    badgeName,
    criteria,
    evidenceUrl: user.portfolio_slug ? `${config.publicUrl}/p/${user.portfolio_slug}` : undefined,
    issuedAt,
  });
  const jwt = signCredential(vc, issuerKeys());
  d.insert("credentials", { id: credentialId, user_id: userId, submission_id: submissionId, badge_name: badgeName, milestone, jwt, issued_at: issuedAt });
  audit(null, "credential.issued", "credential", credentialId, { userId, badgeName });
  notify(userId, "You earned a badge", `"${badgeName}" has been added to your portfolio. Employers can verify it with the QR code.`);
  return credentialId;
}

/** Applies a mentor's decision. Runs inside the feedback transaction. */
export function applyDecision(submissionId: string, criteriaMet: boolean) {
  const d = db();
  const s = d.get<{ user_id: string; enrolment_id: string; stage_id: string; sequence: number; challenge_id: string; title: string }>(
    `SELECT s.user_id, s.enrolment_id, s.stage_id, st.sequence, st.challenge_id, c.title FROM submissions s
     JOIN stages st ON st.id = s.stage_id JOIN challenges c ON c.id = st.challenge_id WHERE s.id = ?`,
    submissionId,
  )!;
  if (!criteriaMet) {
    d.run("UPDATE submissions SET status = 'CHANGES_REQUESTED' WHERE id = ?", submissionId);
    notify(s.user_id, "Feedback is ready", `Your mentor reviewed your work on "${s.title}" and suggested changes. Revise and resubmit when ready.`, ["IN_APP", "EMAIL", "SMS"]);
    return { outcome: "CHANGES_REQUESTED" as const };
  }

  d.run("UPDATE submissions SET status = 'APPROVED' WHERE id = ?", submissionId);
  const total = d.get<{ n: number }>("SELECT COUNT(*) n FROM stages WHERE challenge_id = ?", s.challenge_id)!.n;
  const enrolment = d.get<{ current_stage: number }>("SELECT current_stage FROM enrolments WHERE id = ?", s.enrolment_id)!;
  // Only approving the learner's current stage moves them forward.
  if (s.sequence !== enrolment.current_stage) return { outcome: "APPROVED" as const, completed: false };

  if (s.sequence < total) {
    d.run("UPDATE enrolments SET current_stage = ?, progress_pct = ? WHERE id = ?", s.sequence + 1, Math.round((s.sequence / total) * 100), s.enrolment_id);
    notify(s.user_id, "Stage approved", `Stage ${s.sequence} of "${s.title}" was approved. Stage ${s.sequence + 1} is now unlocked.`, ["IN_APP", "EMAIL", "SMS"]);
    return { outcome: "APPROVED" as const, completed: false };
  }

  d.run("UPDATE enrolments SET status = 'COMPLETED', progress_pct = 100, completed_at = ? WHERE id = ?", now(), s.enrolment_id);
  audit(null, "enrolment.completed", "enrolment", s.enrolment_id, { userId: s.user_id, challengeId: s.challenge_id });
  const badges = [issueBadge(s.user_id, `${s.title}: Completed`, "CHALLENGE_COMPLETE", `Completed every stage of "${s.title}" with mentor approval.`, submissionId)];
  const completedCount = d.get<{ n: number }>("SELECT COUNT(*) n FROM enrolments WHERE user_id = ? AND status = 'COMPLETED'", s.user_id)!.n;
  for (const m of MILESTONES) {
    if (completedCount === m.count) badges.push(issueBadge(s.user_id, m.name, `MILESTONE_${m.count}`, m.criteria, submissionId));
  }
  return { outcome: "APPROVED" as const, completed: true, badges };
}
