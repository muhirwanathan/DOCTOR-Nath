// Mentor assignment. Every submission goes to the mentor with the best weighted
// score; each factor is returned so the choice can be explained and audited.

export interface MentorCandidate {
  id: string;
  expertise: string[];
  language: string;
  capacity: number;
  activeLoad: number;
  /** Median days from assignment to feedback; undefined for new mentors. */
  medianTurnaroundDays?: number;
  /** Reviewed an earlier version of this same stage for this learner. */
  reviewedPreviousVersion: boolean;
}

export interface SubmissionContext {
  learnerId: string;
  learnerLanguage: string;
  theme: string;
  skills: string[];
  slaDays: number;
  /** Mentors who must not get this submission (the learner, or a mentor who missed the SLA). */
  exclude: Set<string>;
}

export const WEIGHTS = { expertise: 0.45, workload: 0.25, speed: 0.15, language: 0.15, continuity: 0.2 } as const;

export interface ScoredMentor {
  mentorId: string;
  score: number;
  overCapacity: boolean;
  factors: { expertise: number; workload: number; speed: number; language: number; continuity: number };
}

const norm = (s: string) => s.trim().toLowerCase();

export function scoreMentor(m: MentorCandidate, ctx: SubmissionContext): ScoredMentor {
  const wanted = new Set([ctx.theme, ...ctx.skills].map(norm));
  const has = new Set(m.expertise.map(norm));
  const overlap = [...wanted].filter((w) => has.has(w)).length;
  const expertise = wanted.size ? overlap / wanted.size : 0;
  const workload = m.capacity > 0 ? Math.max(0, 1 - m.activeLoad / m.capacity) : 0;
  // New mentors get a neutral speed score instead of being penalised for no history.
  const speed = m.medianTurnaroundDays === undefined ? 0.5 : Math.max(0, 1 - m.medianTurnaroundDays / ctx.slaDays);
  const language = norm(m.language) === norm(ctx.learnerLanguage) ? 1 : 0;
  const continuity = m.reviewedPreviousVersion ? 1 : 0;
  const factors = { expertise, workload, speed, language, continuity };
  const score =
    WEIGHTS.expertise * expertise +
    WEIGHTS.workload * workload +
    WEIGHTS.speed * speed +
    WEIGHTS.language * language +
    WEIGHTS.continuity * continuity;
  return { mentorId: m.id, score, overCapacity: m.activeLoad >= m.capacity, factors };
}

/**
 * Ranks eligible mentors. Mentors at capacity are used only when every mentor is
 * full, so one overloaded expert never becomes a bottleneck for the queue.
 */
export function rankMentors(mentors: MentorCandidate[], ctx: SubmissionContext): ScoredMentor[] {
  const eligible = mentors.filter((m) => m.id !== ctx.learnerId && !ctx.exclude.has(m.id));
  const scored = eligible.map((m) => scoreMentor(m, ctx));
  const byScore = (a: ScoredMentor, b: ScoredMentor) => b.score - a.score || a.mentorId.localeCompare(b.mentorId);
  const open = scored.filter((s) => !s.overCapacity).sort(byScore);
  return open.length ? open : scored.sort(byScore);
}

export function chooseMentor(mentors: MentorCandidate[], ctx: SubmissionContext): ScoredMentor | null {
  return rankMentors(mentors, ctx)[0] ?? null;
}

/** SLA state of an active assignment at time `nowMs`. */
export function slaState(assignedAt: string, dueAt: string, nowMs: number, warnFraction: number) {
  const start = Date.parse(assignedAt);
  const due = Date.parse(dueAt);
  const elapsed = (nowMs - start) / (due - start);
  if (nowMs >= due) return "BREACHED" as const;
  if (elapsed >= warnFraction) return "AT_RISK" as const;
  return "ON_TRACK" as const;
}
