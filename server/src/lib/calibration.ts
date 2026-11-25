import { mean, sd } from "./stats.js";

// Mentor rating calibration. A "4/5" from a harsh mentor and from a generous one
// mean different things, which distorts portfolios and recommendations.
// We estimate each mentor's bias as their mean offset from the global mean,
// shrunk towards zero by empirical Bayes: bias = n / (n + k) * (mentorMean - globalMean).
// With few reviews the estimate stays near zero; with many it approaches the raw offset.

export interface Rating {
  mentorId: string;
  rating: number;
}

export interface MentorCalibration {
  mentorId: string;
  n: number;
  mean: number;
  bias: number;
  label: "HARSH" | "GENEROUS" | "TYPICAL";
}

export interface CalibrationModel {
  globalMean: number;
  globalSd: number;
  shrinkage: number;
  mentors: Map<string, MentorCalibration>;
}

export const LABEL_THRESHOLD = 0.3;

export function fitCalibration(ratings: Rating[], shrinkage = 5): CalibrationModel {
  const all = ratings.map((r) => r.rating);
  const globalMean = all.length ? mean(all) : 3;
  const byMentor = new Map<string, number[]>();
  for (const r of ratings) {
    const list = byMentor.get(r.mentorId) ?? [];
    list.push(r.rating);
    byMentor.set(r.mentorId, list);
  }
  const mentors = new Map<string, MentorCalibration>();
  for (const [mentorId, rs] of byMentor) {
    const m = mean(rs);
    const bias = (rs.length / (rs.length + shrinkage)) * (m - globalMean);
    const label = bias <= -LABEL_THRESHOLD ? "HARSH" : bias >= LABEL_THRESHOLD ? "GENEROUS" : "TYPICAL";
    mentors.set(mentorId, { mentorId, n: rs.length, mean: m, bias, label });
  }
  return { globalMean, globalSd: all.length > 1 ? sd(all) : 0, shrinkage, mentors };
}

/** Rating with the mentor's estimated bias removed, kept on the 1-5 scale. */
export function calibrate(model: CalibrationModel, mentorId: string, rating: number): number {
  const bias = model.mentors.get(mentorId)?.bias ?? 0;
  return Math.min(5, Math.max(1, rating - bias));
}
