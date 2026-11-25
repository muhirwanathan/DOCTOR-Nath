import { existsSync, rmSync } from "node:fs";
import { config } from "./config.js";
import { db, id } from "./db.js";
import { hashPassword } from "./lib/password.js";
import { audit } from "./services/audit.js";
import { issueBadge } from "./services/progress.js";

// Demo data for a Kigali pilot a few weeks in. Timestamps are back-dated so the
// dashboard, SLA board and recommendations have history to work with.

for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) if (existsSync(f)) rmSync(f);
const d = db();

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const password = hashPassword("password123");
const user = (name: string, email: string, role: string, extra: Record<string, string | number> = {}) => {
  const uid = id();
  const slug = `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${uid.slice(0, 6)}`;
  d.insert("users", { id: uid, name, email, password_hash: password, role, created_at: ago(60), portfolio_slug: slug, ...extra });
  return uid;
};

const admin = user("Pilot Admin", "admin@drnath.rw", "ADMIN");
const mentors = [
  { id: user("Eric Habimana", "eric@drnath.rw", "MENTOR", { expertise: JSON.stringify(["AGRICULTURE", "prototyping", "testing", "research"]), language: "rw", capacity: 4 }), bias: -1 },
  { id: user("Grace Uwase", "grace@drnath.rw", "MENTOR", { expertise: JSON.stringify(["HEALTH", "sms", "user research", "EDUCATION"]), capacity: 5 }), bias: 1 },
  { id: user("Jean Mugisha", "jean@drnath.rw", "MENTOR", { expertise: JSON.stringify(["ICT", "databases", "sms", "data analysis"]), capacity: 5 }), bias: 0 },
  { id: user("Diane Ingabire", "diane@drnath.rw", "MENTOR", { expertise: JSON.stringify(["EDUCATION", "AGRICULTURE", "design", "research"]), capacity: 3 }), bias: 0 },
];

const challenge = (title: string, theme: string, difficulty: number, weeks: number, skills: string[], brief: string, stages: [string, string, string][], prerequisites: string[] = []) => {
  const cid = id();
  d.insert("challenges", { id: cid, title, brief, theme, difficulty, duration_weeks: weeks, status: "LIVE", skills: JSON.stringify(skills), prerequisites: JSON.stringify(prerequisites), created_by: admin, created_at: ago(58) });
  const stageIds = stages.map(([t, b, c], i) => {
    const sid = id();
    d.insert("stages", { id: sid, challenge_id: cid, sequence: i + 1, title: t, brief: b, criteria: c });
    return sid;
  });
  return { id: cid, title, theme, stageIds };
};

const harvest = challenge("Reduce post-harvest loss", "AGRICULTURE", 1, 3, ["research", "prototyping"],
  "Smallholder maize farmers in Nyagatare lose up to a third of their harvest to moisture and pests. Design a low-cost way to store maize safely for at least three months.",
  [
    ["Understand the problem", "Interview or research 3+ farmers. What causes losses and what do they use now?", "At least 3 sources; losses are quantified; current methods described."],
    ["Prototype", "Design a low-cost storage method. Share a sketch and a short explanation.", "Costs under 15,000 RWF; uses locally available materials; sketch included."],
    ["Test", "Test your prototype or a model of it for at least one week and record results.", "Clear before/after measurements; honest about what failed."],
    ["Pitch", "Write a one-page pitch a cooperative could act on.", "States cost, benefit and next step in plain language."],
  ]);
const clinic = challenge("Clinic queue SMS alerts", "HEALTH", 2, 2, ["sms", "user research"],
  "Patients at a Kicukiro health centre wait hours without knowing when they will be seen. Design an SMS system that tells them when their turn is near.",
  [
    ["Map the journey", "Map a patient's visit from arrival to consultation.", "Journey has 5+ steps with pain points marked."],
    ["Design the messages", "Write the SMS flow, including Kinyarwanda versions.", "Messages under 160 characters; works on basic phones; bilingual."],
    ["Pilot plan", "Plan a one-week pilot with the clinic.", "Measurable success metric and a named clinic contact."],
  ]);
const sacco = challenge("Digital records for a SACCO", "ICT", 3, 4, ["databases", "data analysis"],
  "A savings cooperative in Huye keeps member records in paper ledgers. Design a simple digital record system that volunteers can run.",
  [
    ["Requirements", "List what records the SACCO keeps and who uses them.", "Covers members, savings and loans; at least two user roles."],
    ["Data model", "Design the tables and how they relate.", "Normalised tables with keys; handles a loan repayment."],
    ["Working prototype", "Build a spreadsheet or app prototype with sample data.", "Volunteer can add a member and record a payment unaided."],
  ], [clinic.id]);
const market = challenge("Market price board for farmers", "AGRICULTURE", 2, 3, ["research", "data analysis", "sms"],
  "Farmers sell to middlemen without knowing prices in nearby markets. Design a way to share daily prices.",
  [
    ["Price research", "Collect a week of prices from 2+ markets.", "Real prices with dates and sources."],
    ["Design the board", "Design how prices reach farmers (SMS, radio, board).", "Reaches farmers without smartphones; updated daily."],
  ], [harvest.id]);
const attendance = challenge("School attendance tracker", "EDUCATION", 2, 2, ["design", "data analysis"],
  "A primary school in Musanze wants to spot pupils at risk of dropping out early. Design an attendance tracker teachers will use.",
  [
    ["Talk to teachers", "Find out how attendance is recorded today.", "2+ teachers consulted; time cost of current method estimated."],
    ["Tracker design", "Design the tracker and the early-warning rule.", "Takes under 2 minutes per class; clear at-risk rule."],
  ]);
const water = challenge("Water point fault reporting", "ICT", 4, 4, ["databases", "sms", "design"],
  "Rural water points stay broken for weeks because faults are not reported. Design a fault-reporting system for a district water office.",
  [
    ["Fault reporting flow", "Design how a villager reports a fault by SMS or USSD.", "Works on any phone; confirms receipt; under 4 steps."],
    ["Operations dashboard", "Design what the district office sees and does.", "Shows open faults by age; assigns technicians."],
  ], [sacco.id]);

const challenges = [harvest, clinic, sacco, market, attendance, water];
const mentorFor = (theme: string, exclude?: string) => {
  const fits = mentors.filter((m) => m.id !== exclude && (d.get<{ expertise: string }>("SELECT expertise FROM users WHERE id = ?", m.id)!.expertise.includes(theme)));
  return pick(fits.length ? fits : mentors);
};
/** Least-loaded mentor with the right expertise, as the live matcher would pick. */
const leastLoaded = (theme: string) => {
  const fits = mentors.filter((m) => d.get<{ expertise: string }>("SELECT expertise FROM users WHERE id = ?", m.id)!.expertise.includes(theme));
  const load = (mid: string) => d.get<{ n: number }>("SELECT COUNT(*) n FROM assignments WHERE mentor_id = ? AND status = 'ACTIVE'", mid)!.n;
  return (fits.length ? fits : mentors).sort((a, b) => load(a.id) - load(b.id))[0]!;
};
// Days each pending submission has waited: includes one overdue (> 5) and two due soon.
const WAITS = [6, 4.2, 1, 3.5, 0.5, 2, 5.5, 1.5];
let waitIdx = 0;

const SAMPLES = [
  "I interviewed four farmers in Nyagatare. They lose about 25-30% of maize to weevils and damp. Most use polypropylene sacks on the floor.",
  "Hermetic bag lined with local sisal, tested with 20 kg of maize for 10 days. Moisture stayed at 13%. Cost about 9,000 RWF.",
  "Draft SMS flow: 1) Registration confirms queue number 2) Alert when 5 patients ahead 3) Final call. Kinyarwanda versions included.",
  "Tables: members, accounts, transactions, loans, repayments. A repayment inserts a transaction and updates the loan balance.",
  "Teachers spend about 10 minutes per class on paper registers. A pupil missing 3 days in 2 weeks is flagged for a home visit.",
];

const learnerNames = ["Aline Uwimana", "Patrick Niyonzima", "Claudine Mukamana", "Eric Nshimiyimana", "Divine Iradukunda", "Samuel Habineza", "Josiane Umutoni", "Olivier Ndayisaba", "Ange Mutoni", "Kevin Hakizimana", "Sandrine Uwera", "Moses Bizimana", "Fiona Ishimwe", "Yves Manzi"];
const learners = learnerNames.map((n, i) =>
  user(n, `${n.split(" ")[0]!.toLowerCase()}@example.rw`, "LEARNER", {
    language: i % 4 === 0 ? "rw" : "en",
    phone: `+25078${String(1000000 + i * 7919).slice(0, 7)}`,
    skills: JSON.stringify(pick([["research"], ["design"], ["sms"], [], ["data analysis"]])),
    portfolio_public: i % 3 === 0 ? 1 : 0,
  }),
);

const answers = (level: number) => Array.from({ length: 5 }, () => Math.max(1, Math.min(5, Math.round(level + (rand() - 0.5) * 1.6))));
const survey = (uid: string, type: string, level: number, daysAgo: number) => {
  const a = answers(level);
  d.insert("survey_responses", { id: id(), user_id: uid, type, confidence_score: a.reduce((s, x) => s + x, 0) / a.length, answers: JSON.stringify(a), submitted_at: ago(daysAgo) });
};

const completions: { learner: string; challengeId: string; lastSubmission: string }[] = [];

/** Plays a learner through `stagesDone` stages, with realistic revision loops and turnaround times. */
function play(learner: string, c: (typeof challenges)[number], stagesDone: number, startDaysAgo: number, finalState: "complete" | "pending" | "none") {
  const enrolmentId = id();
  const total = c.stageIds.length;
  let t = startDaysAgo;
  d.insert("enrolments", { id: enrolmentId, user_id: learner, challenge_id: c.id, current_stage: Math.min(stagesDone + 1, total), progress_pct: Math.round((stagesDone / total) * 100), status: "ACTIVE", enrolled_at: ago(t) });
  audit(learner, "enrolment.created", "enrolment", enrolmentId, { challengeId: c.id });
  let last = "";
  for (let s = 0; s < stagesDone; s++) {
    const versions = rand() < 0.4 ? 2 : 1;
    let mentor = mentorFor(c.theme);
    for (let v = 1; v <= versions; v++) {
      t = Math.max(1.2, t - (1 + rand() * 2)); // never let back-dated history run into the future
      const subId = id();
      last = subId;
      const approved = v === versions;
      d.insert("submissions", { id: subId, enrolment_id: enrolmentId, stage_id: c.stageIds[s]!, user_id: learner, content: pick(SAMPLES), version: v, status: approved ? "APPROVED" : "CHANGES_REQUESTED", submitted_at: ago(t) });
      const turnaround = 0.5 + rand() * (rand() < 0.15 ? 7 : 4); // ~15% slower than the 5-day target
      d.insert("assignments", { id: id(), submission_id: subId, mentor_id: mentor.id, assigned_at: ago(t), due_at: ago(t - config.feedbackSlaDays), status: "DONE", score: 0.7 + rand() * 0.2, reason: JSON.stringify({ factors: {} }) });
      const base = approved ? 4 : 2.5;
      const rating = Math.max(1, Math.min(5, Math.round(base + mentor.bias + (rand() - 0.5))));
      d.insert("feedback", {
        id: id(),
        submission_id: subId,
        mentor_id: mentor.id,
        strengths: "Clear evidence from real users and a realistic budget.",
        improvements: approved ? "Next, think about how this scales to a whole cooperative." : "Add measurements: how much did losses actually fall?",
        rating,
        criteria_met: approved ? 1 : 0,
        ai_assisted: rand() < 0.3 ? 1 : 0,
        created_at: ago(Math.max(0.1, t - turnaround)),
      });
      t = Math.max(1.1, t - turnaround);
      if (v < versions && rand() < 0.5) mentor = mentorFor(c.theme, mentor.id);
    }
  }
  if (finalState === "complete") {
    d.run("UPDATE enrolments SET status = 'COMPLETED', progress_pct = 100, current_stage = ?, completed_at = ? WHERE id = ?", total, ago(Math.max(0.5, t)), enrolmentId);
    completions.push({ learner, challengeId: c.id, lastSubmission: last });
  } else if (finalState === "pending") {
    // Latest stage is waiting on a mentor; some reviews are drifting past the deadline.
    const stageIdx = Math.min(stagesDone, total - 1);
    const subId = id();
    const waited = WAITS[waitIdx++ % WAITS.length]!;
    d.insert("submissions", { id: subId, enrolment_id: enrolmentId, stage_id: c.stageIds[stageIdx]!, user_id: learner, content: pick(SAMPLES), version: 1, status: "SUBMITTED", submitted_at: ago(waited) });
    const m = leastLoaded(c.theme);
    d.insert("assignments", { id: id(), submission_id: subId, mentor_id: m.id, assigned_at: ago(waited), due_at: ago(waited - config.feedbackSlaDays), status: "ACTIVE", score: 0.6 + rand() * 0.3, reason: JSON.stringify({ factors: { expertise: 1, workload: 0.6, speed: 0.5, language: 1, continuity: 0 } }), warned: waited > 3 ? 1 : 0 });
  }
}

d.tx(() => {
  learners.forEach((l, i) => {
    const pre = 2.2 + rand() * 1.2;
    survey(l, "PRE", pre, 50 - i);
    if (i < 6) {
      play(l, harvest, 4, 45 - i, "complete");
      if (i < 3) play(l, market, 2, 22 - i, "complete");
      if (i === 0) play(l, clinic, 3, 16, "complete");
      if (i % 2 === 0) play(l, i === 0 ? attendance : clinic, 1, 10, "pending");
      // Most completers report higher confidence; one does not, so the test is not a foregone conclusion.
      survey(l, "POST", i === 4 ? pre - 0.2 : pre + 0.6 + rand() * 0.9, 2);
    } else if (i < 10) {
      play(l, [harvest, clinic, attendance, harvest][i - 6]!, 1, 30 - i, "pending");
    } else if (i < 12) {
      play(l, harvest, 1, 20, "none");
    }
  });
});

d.tx(() => {
  const counts = new Map<string, number>();
  for (const c of completions) {
    const ch = challenges.find((x) => x.id === c.challengeId)!;
    issueBadge(c.learner, `${ch.title}: Completed`, "CHALLENGE_COMPLETE", `Completed every stage of "${ch.title}" with mentor approval.`, c.lastSubmission);
    const n = (counts.get(c.learner) ?? 0) + 1;
    counts.set(c.learner, n);
    if (n === 1) issueBadge(c.learner, "First Project", "MILESTONE_1", "Completed a first challenge with mentor-approved work on every stage.", c.lastSubmission);
    if (n === 3) issueBadge(c.learner, "Problem Solver", "MILESTONE_3", "Completed three challenges with mentor-approved work on every stage.", c.lastSubmission);
  }
  d.run("DELETE FROM notifications"); // seed history should not flood real inboxes
});

console.log(`Seeded ${learners.length} learners, ${mentors.length} mentors, ${challenges.length} challenges.`);
for (const q of d.all<{ email: string; n: number }>(
  "SELECT u.email, COUNT(a.id) n FROM users u LEFT JOIN assignments a ON a.mentor_id = u.id AND a.status = 'ACTIVE' WHERE u.role = 'MENTOR' GROUP BY u.email",
)) console.log(`  ${q.email}: ${q.n} review(s) in queue`);
console.log("Log in with password 'password123':");
console.log("  admin@drnath.rw (admin)  eric@drnath.rw / grace@drnath.rw (mentors)  aline@example.rw / patrick@example.rw (learners)");
