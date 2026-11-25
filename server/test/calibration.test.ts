import { describe, expect, it } from "vitest";
import { calibrate, fitCalibration } from "../src/lib/calibration.js";

describe("rating calibration", () => {
  const ratings = [
    ...Array(10).fill({ mentorId: "harsh", rating: 2 }),
    ...Array(10).fill({ mentorId: "kind", rating: 5 }),
    { mentorId: "new", rating: 5 },
  ];

  it("labels mentors and shrinks thin evidence", () => {
    const m = fitCalibration(ratings);
    expect(m.mentors.get("harsh")!.label).toBe("HARSH");
    expect(m.mentors.get("kind")!.label).toBe("GENEROUS");
    expect(Math.abs(m.mentors.get("new")!.bias)).toBeLessThan(Math.abs(m.mentors.get("kind")!.bias));
  });

  it("pulls ratings towards a common scale within 1-5", () => {
    const m = fitCalibration(ratings);
    expect(calibrate(m, "harsh", 2)).toBeGreaterThan(2);
    expect(calibrate(m, "kind", 5)).toBeLessThan(5);
    expect(calibrate(m, "unknown", 4)).toBe(4);
    expect(calibrate(m, "harsh", 5)).toBe(5);
  });

  it("defaults sensibly with no data", () => {
    expect(fitCalibration([]).globalMean).toBe(3);
  });
});
