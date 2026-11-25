// Statistics for the hypothesis dashboard (Part A, Section 7):
//   H1: >= 60% of active users complete one or more projects
//   H2: >= 70% report higher problem-solving confidence (pre vs post survey)

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Sample standard deviation (n - 1). */
export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function logGamma(z: number): number {
  // Lanczos approximation, accurate to ~1e-15 for z > 0.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const EPS = 1e-14;
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** CDF of Student's t distribution with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Critical value t* with P(T <= t*) = p, found by bisection. */
export function tQuantile(p: number, df: number): number {
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface PairedTTest {
  n: number;
  meanPre: number;
  meanPost: number;
  meanDiff: number;
  sdDiff: number;
  t: number;
  df: number;
  /** One-sided p for H_a: post > pre. */
  pOneSided: number;
  pTwoSided: number;
  /** Cohen's d_z = mean difference / sd of differences. */
  cohensDz: number;
  ci95: [number, number];
  /** Share of learners whose post score beats their pre score. */
  shareImproved: number;
}

export function pairedTTest(pre: number[], post: number[]): PairedTTest | null {
  if (pre.length !== post.length) throw new Error("pre and post must be paired");
  const n = pre.length;
  if (n < 2) return null;
  const diffs = post.map((p, i) => p - pre[i]!);
  const md = mean(diffs);
  const s = sd(diffs);
  const df = n - 1;
  const se = s / Math.sqrt(n);
  const t = se === 0 ? (md === 0 ? 0 : Math.sign(md) * Infinity) : md / se;
  const pOne = Number.isFinite(t) ? 1 - tCdf(t, df) : t > 0 ? 0 : 1;
  const pTwo = Number.isFinite(t) ? 2 * Math.min(tCdf(t, df), 1 - tCdf(t, df)) : 0;
  const tStar = tQuantile(0.975, df);
  return {
    n,
    meanPre: mean(pre),
    meanPost: mean(post),
    meanDiff: md,
    sdDiff: s,
    t,
    df,
    pOneSided: pOne,
    pTwoSided: pTwo,
    cohensDz: s === 0 ? NaN : md / s,
    ci95: [md - tStar * se, md + tStar * se],
    shareImproved: diffs.filter((d) => d > 0).length / n,
  };
}

/** Wilson score interval for a proportion (95% by default). */
export function wilson(successes: number, n: number, z = 1.959964): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export type TargetVerdict = "MET" | "NOT_MET" | "INCONCLUSIVE";

/**
 * Compares a proportion with a target using its 95% Wilson interval:
 * MET when the whole interval is at or above the target, NOT_MET when it is entirely below.
 */
export function proportionVsTarget(successes: number, n: number, target: number) {
  const ci = wilson(successes, n);
  const verdict: TargetVerdict = ci[0] >= target ? "MET" : ci[1] < target ? "NOT_MET" : "INCONCLUSIVE";
  return { successes, n, rate: n ? successes / n : 0, ci95: ci, target, verdict };
}
