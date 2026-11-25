// Next-challenge recommendations from a skill graph.
//  1. Mastery: each approved stage adds evidence to its challenge's skills, weighted by
//     the calibrated mentor rating and decayed with a 90-day half-life; 1 - e^-x maps it to [0, 1).
//  2. Stretch: aim one difficulty level above what the learner has completed.
//  3. Peers: learners with similar completed sets (Jaccard) vote for what they did next.
//  Challenges whose prerequisites are not complete are never recommended.

export interface ChallengeNode {
  id: string;
  title: string;
  theme: string;
  skills: string[];
  difficulty: number; // 1-5
  prerequisites: string[];
}

export interface Evidence {
  challengeId: string;
  calibratedRating: number; // 1-5
  approvedAt: string;
}

export interface LearnerState {
  declaredSkills: string[];
  evidence: Evidence[];
  completed: Set<string>;
  enrolled: Set<string>;
}

export interface Recommendation {
  challengeId: string;
  title: string;
  score: number;
  reasons: string[];
  factors: { novelty: number; stretch: number; readiness: number; peers: number };
}

export const REC_WEIGHTS = { novelty: 0.35, stretch: 0.3, readiness: 0.15, peers: 0.2 } as const;
const HALF_LIFE_DAYS = 90;
const DECLARED_PRIOR = 0.2;

const norm = (s: string) => s.trim().toLowerCase();

export function skillMastery(state: LearnerState, challenges: Map<string, ChallengeNode>, nowMs: number) {
  const raw = new Map<string, number>();
  for (const e of state.evidence) {
    const c = challenges.get(e.challengeId);
    if (!c) continue;
    const ageDays = Math.max(0, (nowMs - Date.parse(e.approvedAt)) / 86_400_000);
    const decay = 0.5 ** (ageDays / HALF_LIFE_DAYS);
    const weight = (e.calibratedRating / 5) * decay * (0.6 + 0.2 * c.difficulty);
    for (const s of c.skills) raw.set(norm(s), (raw.get(norm(s)) ?? 0) + weight);
  }
  const mastery = new Map<string, number>();
  for (const s of state.declaredSkills) mastery.set(norm(s), DECLARED_PRIOR);
  for (const [s, x] of raw) mastery.set(s, Math.max(mastery.get(s) ?? 0, 1 - Math.exp(-x)));
  return mastery;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function recommend(
  state: LearnerState,
  challengeList: ChallengeNode[],
  peers: Set<string>[],
  nowMs: number,
  limit = 3,
): { recommendations: Recommendation[]; locked: { challengeId: string; title: string; missing: string[] }[] } {
  const challenges = new Map(challengeList.map((c) => [c.id, c]));
  const mastery = skillMastery(state, challenges, nowMs);
  const done = [...state.completed].map((id) => challenges.get(id)).filter(Boolean) as ChallengeNode[];
  const level = done.length ? done.reduce((s, c) => s + c.difficulty, 0) / done.length : 1;
  const target = Math.min(5, Math.max(1, Math.round(level) + (done.length ? 1 : 0)));

  const similar = peers
    .map((p) => ({ set: p, sim: jaccard(state.completed, p) }))
    .filter((p) => p.sim > 0 || state.completed.size === 0);
  const simTotal = similar.reduce((s, p) => s + (p.sim || 1), 0);

  const recommendations: Recommendation[] = [];
  const locked: { challengeId: string; title: string; missing: string[] }[] = [];

  for (const c of challengeList) {
    if (state.completed.has(c.id) || state.enrolled.has(c.id)) continue;
    const missing = c.prerequisites.filter((p) => !state.completed.has(p));
    if (missing.length) {
      locked.push({ challengeId: c.id, title: c.title, missing: missing.map((m) => challenges.get(m)?.title ?? m) });
      continue;
    }
    const ms = c.skills.map((s) => mastery.get(norm(s)) ?? 0);
    const novelty = ms.length ? ms.reduce((s, m) => s + (1 - m), 0) / ms.length : 0.5;
    const readiness = ms.length ? Math.max(...ms) : 0;
    const stretch = 1 - Math.abs(c.difficulty - target) / 4;
    const peersScore = simTotal
      ? similar.filter((p) => p.set.has(c.id)).reduce((s, p) => s + (p.sim || 1), 0) / simTotal
      : 0;
    const factors = { novelty, stretch, readiness, peers: peersScore };
    const score =
      REC_WEIGHTS.novelty * novelty +
      REC_WEIGHTS.stretch * stretch +
      REC_WEIGHTS.readiness * readiness +
      REC_WEIGHTS.peers * peersScore;

    const reasons: string[] = [];
    const fresh = c.skills.filter((s) => (mastery.get(norm(s)) ?? 0) < 0.3);
    if (fresh.length) reasons.push(`Builds new skills: ${fresh.join(", ")}`);
    if (c.difficulty === target) reasons.push(`Level ${c.difficulty} matches your next step up`);
    else if (c.difficulty < target) reasons.push(`A lighter level-${c.difficulty} challenge to build momentum`);
    if (readiness >= 0.5) {
      const base = c.skills.filter((s) => (mastery.get(norm(s)) ?? 0) >= 0.5);
      reasons.push(`Uses skills you have shown: ${base.join(", ")}`);
    }
    if (peersScore >= 0.25) reasons.push(`${Math.round(peersScore * 100)}% of learners like you took it`);
    if (c.prerequisites.length) reasons.push("Unlocked by a challenge you completed");
    recommendations.push({ challengeId: c.id, title: c.title, score, reasons, factors });
  }

  recommendations.sort((a, b) => b.score - a.score || a.challengeId.localeCompare(b.challengeId));
  return { recommendations: recommendations.slice(0, limit), locked };
}
