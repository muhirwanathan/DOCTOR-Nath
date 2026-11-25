import { describe, expect, it } from "vitest";
import { jaccard, recommend, skillMastery, type ChallengeNode } from "../src/lib/recommend.js";

describe("recommendations", () => {
  const challenges: ChallengeNode[] = [
    { id: "c1", title: "Intro agri", theme: "AGRICULTURE", skills: ["research", "prototyping"], difficulty: 1, prerequisites: [] },
    { id: "c2", title: "Storage design", theme: "AGRICULTURE", skills: ["prototyping", "testing"], difficulty: 2, prerequisites: ["c1"] },
    { id: "c3", title: "SMS alerts", theme: "HEALTH", skills: ["sms", "databases"], difficulty: 3, prerequisites: [] },
    { id: "c4", title: "Advanced", theme: "ICT", skills: ["databases"], difficulty: 4, prerequisites: ["c3"] },
  ];
  const now = Date.parse("2026-11-20T00:00:00Z");

  it("builds mastery from evidence with decay", () => {
    const m = skillMastery(
      { declaredSkills: ["design"], evidence: [{ challengeId: "c1", calibratedRating: 5, approvedAt: "2026-11-19T00:00:00Z" }], completed: new Set(["c1"]), enrolled: new Set() },
      new Map(challenges.map((c) => [c.id, c])),
      now,
    );
    expect(m.get("research")!).toBeGreaterThan(0.4);
    expect(m.get("design")).toBe(0.2);
  });

  it("never recommends locked or finished challenges and explains picks", () => {
    const state = { declaredSkills: [], evidence: [{ challengeId: "c1", calibratedRating: 4, approvedAt: "2026-11-10T00:00:00Z" }], completed: new Set(["c1"]), enrolled: new Set<string>() };
    const { recommendations, locked } = recommend(state, challenges, [new Set(["c1", "c2"]), new Set(["c3"])], now, 5);
    const ids = recommendations.map((r) => r.challengeId);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("c4");
    expect(ids[0]).toBe("c2");
    expect(locked.find((l) => l.challengeId === "c4")!.missing).toEqual(["SMS alerts"]);
    expect(recommendations[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("computes jaccard similarity", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});
