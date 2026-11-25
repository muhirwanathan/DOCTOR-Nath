import { describe, expect, it } from "vitest";
import { incompleteBeta, mean, pairedTTest, proportionVsTarget, sd, tCdf, tQuantile, wilson } from "../src/lib/stats.js";

describe("statistics", () => {
  it("computes mean and sample sd", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([1])).toBeNaN();
  });

  it("matches known t-distribution values", () => {
    expect(tCdf(0, 10)).toBeCloseTo(0.5, 10);
    expect(tCdf(2.228, 10)).toBeCloseTo(0.975, 3);
    expect(tCdf(-1.812, 10)).toBeCloseTo(0.05, 3);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228, 2);
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
  });

  it("runs a paired t-test", () => {
    const pre = [3.0, 2.5, 3.5, 2.0, 3.0, 2.5, 4.0, 3.0];
    const post = [4.0, 3.5, 3.5, 3.0, 4.5, 3.0, 4.5, 3.5];
    const r = pairedTTest(pre, post)!;
    expect(r.n).toBe(8);
    // diffs = [1, 1, 0, 1, 1.5, 0.5, 0.5, 0.5]: mean 0.75, sd 0.4629, t = 0.75 / (0.4629 / sqrt 8)
    expect(r.meanDiff).toBeCloseTo(0.75, 10);
    expect(r.sdDiff).toBeCloseTo(0.46291, 4);
    expect(r.t).toBeCloseTo(4.583, 2);
    expect(r.pOneSided).toBeLessThan(0.01);
    expect(r.ci95[0]).toBeGreaterThan(0);
    expect(r.shareImproved).toBe(7 / 8);
    expect(pairedTTest([1], [2])).toBeNull();
    expect(() => pairedTTest([1, 2], [1])).toThrow();
  });

  it("handles identical differences without dividing by zero", () => {
    const r = pairedTTest([1, 2, 3], [2, 3, 4])!;
    expect(r.t).toBe(Infinity);
    expect(r.pOneSided).toBe(0);
  });

  it("gives Wilson intervals and target verdicts", () => {
    const [lo, hi] = wilson(60, 100);
    expect(lo).toBeCloseTo(0.502, 2);
    expect(hi).toBeCloseTo(0.691, 2);
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(proportionVsTarget(90, 100, 0.6).verdict).toBe("MET");
    expect(proportionVsTarget(20, 100, 0.6).verdict).toBe("NOT_MET");
    expect(proportionVsTarget(6, 10, 0.6).verdict).toBe("INCONCLUSIVE");
  });
});
