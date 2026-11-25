import { describe, expect, it } from "vitest";
import { chooseMentor, rankMentors, scoreMentor, slaState, type MentorCandidate } from "../src/lib/matching.js";

describe("mentor matching", () => {
  const base = { language: "en", capacity: 5, activeLoad: 0, reviewedPreviousVersion: false };
  const mentors: MentorCandidate[] = [
    { ...base, id: "agri", expertise: ["AGRICULTURE", "prototyping"], medianTurnaroundDays: 2 },
    { ...base, id: "ict", expertise: ["ICT", "databases"], medianTurnaroundDays: 1 },
    { ...base, id: "busy", expertise: ["AGRICULTURE", "prototyping"], activeLoad: 5 },
  ];
  const ctx = { learnerId: "l1", learnerLanguage: "en", theme: "AGRICULTURE", skills: ["prototyping"], slaDays: 5, exclude: new Set<string>() };

  it("prefers the expert with spare capacity", () => {
    expect(chooseMentor(mentors, ctx)!.mentorId).toBe("agri");
  });

  it("skips excluded mentors and the learner themself", () => {
    const ranked = rankMentors([...mentors, { ...base, id: "l1", expertise: ["AGRICULTURE"] }], { ...ctx, exclude: new Set(["agri"]) });
    expect(ranked.map((r) => r.mentorId)).not.toContain("agri");
    expect(ranked.map((r) => r.mentorId)).not.toContain("l1");
  });

  it("uses full mentors only when everyone is full", () => {
    const full = mentors.map((m) => ({ ...m, activeLoad: m.capacity }));
    const pick = chooseMentor(full, ctx)!;
    expect(pick.overCapacity).toBe(true);
    expect(chooseMentor([], ctx)).toBeNull();
  });

  it("rewards language match and continuity", () => {
    const s1 = scoreMentor({ ...mentors[1]!, language: "rw" }, { ...ctx, learnerLanguage: "rw" });
    const s2 = scoreMentor(mentors[1]!, { ...ctx, learnerLanguage: "rw" });
    expect(s1.score).toBeGreaterThan(s2.score);
    const cont = scoreMentor({ ...mentors[1]!, reviewedPreviousVersion: true }, ctx);
    expect(cont.factors.continuity).toBe(1);
  });

  it("gives new mentors a neutral speed score", () => {
    expect(scoreMentor({ ...base, id: "n", expertise: [] }, ctx).factors.speed).toBe(0.5);
  });

  it("reports SLA state", () => {
    const t0 = Date.parse("2026-11-01T00:00:00Z");
    const due = "2026-11-06T00:00:00.000Z";
    expect(slaState("2026-11-01T00:00:00Z", due, t0 + 1 * 86_400_000, 0.6)).toBe("ON_TRACK");
    expect(slaState("2026-11-01T00:00:00Z", due, t0 + 4 * 86_400_000, 0.6)).toBe("AT_RISK");
    expect(slaState("2026-11-01T00:00:00Z", due, t0 + 6 * 86_400_000, 0.6)).toBe("BREACHED");
  });
});
