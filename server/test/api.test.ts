import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, id, now } from "../src/db.js";
import { checkSlas } from "../src/services/assign.js";
import { processOutbox } from "../src/services/notify.js";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function call(method: string, url: string, who?: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as "GET", url, payload: payload as object, headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

async function register(key: string, role: "LEARNER" | "MENTOR", extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/api/auth/register", undefined, { name: `Test ${key}`, email: `${key}@test.rw`, password: "password123", role, ...extra });
  expect(r.status).toBe(201);
  tokens[key] = r.body.token;
  ids[key] = r.body.user.id;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await register("learner", "LEARNER", { language: "en" });
  await register("agriMentor", "MENTOR");
  await register("ictMentor", "MENTOR");
  db().run("UPDATE users SET expertise = ? WHERE id = ?", JSON.stringify(["AGRICULTURE", "prototyping"]), ids.agriMentor!);
  db().run("UPDATE users SET expertise = ? WHERE id = ?", JSON.stringify(["ICT"]), ids.ictMentor!);
  // An admin cannot self-register; create one directly, then log in.
  const adminId = id();
  db().insert("users", { id: adminId, name: "Admin", email: "admin@test.rw", password_hash: (await import("../src/lib/password.js")).hashPassword("password123"), role: "ADMIN", created_at: now() });
  tokens.admin = (await call("POST", "/api/auth/login", undefined, { email: "admin@test.rw", password: "password123" })).body.token;
});

afterAll(async () => {
  await app.close();
});

describe("core loop: enrol -> submit -> review -> badge", () => {
  it("rejects bad input with field messages and enforces roles", async () => {
    const bad = await call("POST", "/api/auth/register", undefined, { name: "x", email: "nope", password: "short", role: "ADMIN" });
    expect(bad.status).toBe(400);
    expect(bad.body.details.fields.length).toBeGreaterThan(1);
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("GET", "/api/admin/analytics", "learner")).status).toBe(403);
    expect((await call("POST", "/api/auth/login", undefined, { email: "learner@test.rw", password: "wrong" })).status).toBe(401);
  });

  it("lets an admin publish a challenge", async () => {
    const r = await call("POST", "/api/admin/challenges", "admin", {
      title: "Store maize safely",
      brief: "Design low-cost maize storage for Nyagatare farmers.",
      theme: "AGRICULTURE",
      difficulty: 1,
      durationWeeks: 2,
      skills: ["prototyping"],
      status: "LIVE",
      stages: [
        { title: "Prototype", brief: "Sketch a storage design.", criteria: "Under 15,000 RWF." },
        { title: "Test", brief: "Test it for a week.", criteria: "Measurements recorded." },
      ],
    });
    expect(r.status).toBe(201);
    ids.challenge = r.body.id;
    const detail = await call("GET", `/api/challenges/${ids.challenge}`, "learner");
    ids.stage1 = detail.body.stages[0].id;
    ids.stage2 = detail.body.stages[1].id;
    expect(detail.body.stages[0].unlocked).toBe(false);
  });

  it("requires the pre-survey before the first enrolment", async () => {
    const r = await call("POST", `/api/challenges/${ids.challenge}/enrol`, "learner");
    expect(r.status).toBe(412);
    expect(r.body.details.needsSurvey).toBe("PRE");
    expect((await call("POST", "/api/surveys", "learner", { type: "PRE", answers: [2, 3, 2, 3, 2] })).status).toBe(201);
    expect((await call("POST", "/api/surveys", "learner", { type: "PRE", answers: [2, 3, 2, 3, 2] })).status).toBe(409);
    expect((await call("POST", `/api/challenges/${ids.challenge}/enrol`, "learner")).status).toBe(201);
    expect((await call("POST", `/api/challenges/${ids.challenge}/enrol`, "learner")).body.alreadyEnrolled).toBe(true);
  });

  it("keeps later stages locked", async () => {
    const r = await call("POST", `/api/stages/${ids.stage2}/submissions`, "learner", { content: "Too early" });
    expect(r.status).toBe(403);
  });

  it("merges drafts edited on two devices and reports real conflicts", async () => {
    const base = "Problem: weevils\nIdea: hermetic bag\nCost: unknown";
    expect((await call("PUT", `/api/drafts/${ids.stage1}`, "learner", { content: base, baseVersion: 0, baseContent: "" })).body.version).toBe(1);
    // Laptop edits line 3 against version 1.
    const laptop = await call("PUT", `/api/drafts/${ids.stage1}`, "learner", { content: "Problem: weevils\nIdea: hermetic bag\nCost: 9,000 RWF", baseVersion: 1, baseContent: base });
    expect(laptop.body).toMatchObject({ version: 2, merged: false });
    // Phone was offline, edited line 1 against version 1: merges cleanly.
    const phone = await call("PUT", `/api/drafts/${ids.stage1}`, "learner", { content: "Problem: weevils and damp\nIdea: hermetic bag\nCost: unknown", baseVersion: 1, baseContent: base });
    expect(phone.body).toMatchObject({ version: 3, merged: true, content: "Problem: weevils and damp\nIdea: hermetic bag\nCost: 9,000 RWF" });
    // A third device edits line 2, touching the server's changes on lines 1 and 3.
    // Like Git, diff3 treats adjacent edits as one overlapping block: a conflict for the learner.
    const clash = await call("PUT", `/api/drafts/${ids.stage1}`, "learner", { content: "Problem: weevils\nIdea: clay silo\nCost: unknown", baseVersion: 1, baseContent: base });
    expect(clash.status).toBe(409);
    expect(clash.body.serverVersion).toBe(3);
    expect(clash.body.conflicts[0].local).toContain("Idea: clay silo");
    expect(clash.body.conflicts[0].remote).toContain("Cost: 9,000 RWF");
  });

  it("submits once even when an offline client retries, and routes to the best mentor", async () => {
    const body = { content: "Hermetic bag lined with sisal, 9,000 RWF.", file: { name: "sketch.txt", dataBase64: Buffer.from("sketch").toString("base64") } };
    const first = await call("POST", `/api/stages/${ids.stage1}/submissions`, "learner", body, { "idempotency-key": "k-1" });
    expect(first.status).toBe(201);
    const retry = await call("POST", `/api/stages/${ids.stage1}/submissions`, "learner", body, { "idempotency-key": "k-1" });
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.body.id).toBe(first.body.id);
    expect(db().get<{ n: number }>("SELECT COUNT(*) n FROM submissions")!.n).toBe(1);
    ids.sub1 = first.body.id;

    const fileRes = await app.inject({ method: "GET", url: first.body.fileUrl });
    expect(fileRes.statusCode).toBe(200);
    expect(fileRes.body).toBe("sketch");
    expect((await app.inject({ method: "GET", url: first.body.fileUrl.replace(/sig=[^&]+/, "sig=forged") })).statusCode).toBe(403);

    const queue = await call("GET", "/api/mentor/queue", "agriMentor");
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].learner).toEqual({ id: ids.learner, name: "Test learner" }); // no contact details
    expect((await call("GET", "/api/mentor/queue", "ictMentor")).body).toHaveLength(0);
    expect((await call("POST", `/api/stages/${ids.stage1}/submissions`, "learner", body)).status).toBe(409); // already with a mentor
  });

  it("degrades AI drafting to a clear 503 when Claude is not configured", async () => {
    expect((await call("POST", `/api/submissions/${ids.sub1}/ai-draft`, "ictMentor")).status).toBe(403);
    const r = await call("POST", `/api/submissions/${ids.sub1}/ai-draft`, "agriMentor");
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/write feedback by hand/);
  });

  it("only the assigned mentor can review, and changes requested allow a resubmission", async () => {
    const fb = { strengths: "Good use of local materials.", improvements: "Add moisture readings over time.", rating: 3, criteriaMet: false };
    expect((await call("POST", `/api/submissions/${ids.sub1}/feedback`, "ictMentor", fb)).status).toBe(403);
    expect((await call("POST", `/api/submissions/${ids.sub1}/feedback`, "agriMentor", fb)).body.outcome).toBe("CHANGES_REQUESTED");
    expect((await call("POST", `/api/submissions/${ids.sub1}/feedback`, "agriMentor", fb)).status).toBe(403); // assignment closed

    const v2 = await call("POST", `/api/stages/${ids.stage1}/submissions`, "learner", { content: "Hermetic bag lined with sisal, 9,000 RWF. Moisture held at 13% for 10 days." });
    expect(v2.body.version).toBe(2);
    ids.sub2 = v2.body.id;
    // Continuity: the same mentor gets the resubmission.
    expect((await call("GET", "/api/mentor/queue", "agriMentor")).body[0].submissionId).toBe(ids.sub2);
    const diff = await call("GET", `/api/submissions/${ids.sub2}/diff`, "agriMentor");
    expect(diff.body.previousVersion).toBe(1);
    expect(diff.body.parts.some((p: { added: boolean; value: string }) => p.added && p.value.includes("Moisture"))).toBe(true);
    expect((await call("GET", `/api/submissions/${ids.sub2}/diff`, "ictMentor")).status).toBe(403);
  });

  it("approval unlocks the next stage; finishing issues a verifiable badge", async () => {
    const ok = { strengths: "Clear measurements and low cost.", improvements: "Consider pest control next.", rating: 5, criteriaMet: true };
    expect((await call("POST", `/api/submissions/${ids.sub2}/feedback`, "agriMentor", ok)).body).toMatchObject({ outcome: "APPROVED", completed: false });
    const detail = await call("GET", `/api/challenges/${ids.challenge}`, "learner");
    expect(detail.body.stages[1].unlocked).toBe(true);
    expect(detail.body.enrolment.progressPct).toBe(50);

    const s3 = await call("POST", `/api/stages/${ids.stage2}/submissions`, "learner", { content: "Tested 14 days, losses fell from 25% to 4%." });
    const done = await call("POST", `/api/submissions/${s3.body.id}/feedback`, "agriMentor", ok);
    expect(done.body).toMatchObject({ outcome: "APPROVED", completed: true });
    expect(done.body.badges).toHaveLength(2); // challenge badge + First Project

    const portfolio = await call("GET", "/api/portfolio", "learner");
    expect(portfolio.body.projects).toHaveLength(1);
    const badgeId = portfolio.body.badges[0].id;
    const verify = await call("GET", `/api/public/credentials/${badgeId}`);
    expect(verify.body).toMatchObject({ valid: true, revoked: false });
    expect(verify.body.credential.type).toContain("OpenBadgeCredential");
    expect((await call("POST", "/api/public/verify", undefined, { jwt: verify.body.jwt })).body.valid).toBe(true);
    expect((await call("POST", "/api/public/verify", undefined, { jwt: verify.body.jwt.slice(0, -4) + "AAAA" })).body.valid).toBe(false);
    expect((await call("GET", "/.well-known/did.json")).body.verificationMethod[0].publicKeyJwk.crv).toBe("Ed25519");
  });

  it("keeps portfolios private until shared", async () => {
    const slug = (await call("GET", "/api/me", "learner")).body.portfolioSlug;
    expect((await call("GET", `/api/public/portfolio/${slug}`)).status).toBe(404);
    await call("PATCH", "/api/me", "learner", { portfolioPublic: true });
    expect((await call("GET", `/api/public/portfolio/${slug}`)).body.projects).toHaveLength(1);
  });

  it("opens the post-survey after a completion and shows results on the dashboard", async () => {
    expect((await call("GET", "/api/surveys", "learner")).body.postAvailable).toBe(true);
    await call("POST", "/api/surveys", "learner", { type: "POST", answers: [4, 4, 4, 5, 4] });
    const dash = await call("GET", "/api/admin/analytics", "admin");
    expect(dash.body.hypotheses.completion).toMatchObject({ successes: 1, n: 1 });
    expect(dash.body.hypotheses.confidence.successes).toBe(1);
    expect(dash.body.funnel[0]).toEqual({ step: "Registered learners", n: 1 });
    const csv = await app.inject({ method: "GET", url: "/api/admin/surveys.csv", headers: { authorization: `Bearer ${tokens.admin}` } });
    expect(csv.body.split("\r\n")).toHaveLength(3);
  });

  it("recommends next challenges with reasons", async () => {
    const r = await call("GET", "/api/recommendations", "learner");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.recommendations)).toBe(true);
  });
});

describe("admin editing and login protection", () => {
  it("edits a challenge, keeping stages that hold learner work", async () => {
    const edit = (stages: { title: string; brief: string; criteria: string }[]) =>
      call("PUT", `/api/admin/challenges/${ids.challenge}`, "admin", {
        title: "Store maize safely for 3 months",
        brief: "Design low-cost maize storage for Nyagatare farmers.",
        theme: "AGRICULTURE",
        difficulty: 2,
        durationWeeks: 3,
        skills: ["prototyping", "testing"],
        prerequisites: [],
        stages,
      });
    const s1 = { title: "Prototype v2", brief: "Sketch a storage design.", criteria: "Under 15,000 RWF." };
    // Stage 2 has submissions, so dropping it is refused and nothing changes.
    const refused = await edit([s1]);
    expect(refused.status).toBe(409);
    expect((await call("GET", `/api/challenges/${ids.challenge}`, "admin")).body.title).toBe("Store maize safely");
    // Rewording both and adding a third works; existing stage ids (and their submissions) survive.
    const ok = await edit([s1, { title: "Test", brief: "Test it for a week.", criteria: "Measurements recorded." }, { title: "Pitch", brief: "Pitch it to a cooperative.", criteria: "Cost and benefit stated." }]);
    expect(ok.status).toBe(200);
    const after = (await call("GET", `/api/challenges/${ids.challenge}`, "admin")).body;
    expect(after.title).toBe("Store maize safely for 3 months");
    expect(after.stages.map((s: { title: string }) => s.title)).toEqual(["Prototype v2", "Test", "Pitch"]);
    expect(after.stages[0].id).toBe(ids.stage1);
    expect((await call("PUT", `/api/admin/challenges/${ids.challenge}`, "learner", {})).status).toBe(403);
  });

  it("locks login after 5 failed attempts", async () => {
    await register("victim", "LEARNER");
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/api/auth/login", undefined, { email: "victim@test.rw", password: "wrong-guess" })).status).toBe(401);
    }
    const locked = await call("POST", "/api/auth/login", undefined, { email: "victim@test.rw", password: "password123" });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed attempts/);
  });
});

describe("SLA monitor, notifications and audit", () => {
  it("reassigns a review that misses its deadline, never back to the same mentor", async () => {
    await register("learner2", "LEARNER");
    await call("POST", "/api/surveys", "learner2", { type: "PRE", answers: [3, 3, 3, 3, 3] });
    await call("POST", `/api/challenges/${ids.challenge}/enrol`, "learner2");
    const sub = await call("POST", `/api/stages/${ids.stage1}/submissions`, "learner2", { content: "My storage idea." });
    const before = db().get<{ mentor_id: string }>("SELECT mentor_id FROM assignments WHERE submission_id = ? AND status = 'ACTIVE'", sub.body.id)!;
    const sixDaysLater = Date.now() + 6 * 86_400_000;
    expect(checkSlas(sixDaysLater)).toMatchObject({ reassigned: 1 });
    const after = db().get<{ mentor_id: string }>("SELECT mentor_id FROM assignments WHERE submission_id = ? AND status = 'ACTIVE'", sub.body.id)!;
    expect(after.mentor_id).not.toBe(before.mentor_id);
  });

  it("delivers queued notifications", async () => {
    const delivered = await processOutbox(500);
    expect(delivered).toBeGreaterThan(0);
    const inbox = await call("GET", "/api/notifications", "learner");
    expect(inbox.body.some((n: { subject: string }) => n.subject === "You earned a badge")).toBe(true);
  });

  it("keeps an intact hash chain and detects tampering", async () => {
    const audit = await call("GET", "/api/admin/audit", "admin");
    expect(audit.body.verification.valid).toBe(true);
    expect(audit.body.entries.length).toBeGreaterThan(10);
    db().run("UPDATE audit_log SET data = '{\"rating\":1}' WHERE seq = 5");
    const tampered = await call("GET", "/api/admin/audit", "admin");
    expect(tampered.body.verification).toMatchObject({ valid: false, brokenAt: 5 });
  });

  it("deletes a learner's data and anonymises a mentor", async () => {
    expect((await call("DELETE", "/api/me", "learner2")).status).toBe(200);
    expect(db().get("SELECT 1 FROM submissions WHERE user_id = ?", ids.learner2!)).toBeUndefined();
    expect((await call("DELETE", "/api/me", "agriMentor")).status).toBe(200);
    const m = db().get<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", ids.agriMentor!)!;
    expect(m.name).toBe("Deleted user");
    expect(db().get<{ n: number }>("SELECT COUNT(*) n FROM feedback WHERE mentor_id = ?", ids.agriMentor!)!.n).toBeGreaterThan(0);
    expect((await call("GET", "/api/me", "agriMentor")).status).toBe(401);
  });
});
