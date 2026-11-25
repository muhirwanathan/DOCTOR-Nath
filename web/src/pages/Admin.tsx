import { useState, type FormEvent } from "react";
import { api, download } from "../api";
import { Card, Empty, ErrorBox, fmtDate, Loading, Page, pct, useLoad } from "../components/ui";

interface Verdict { successes: number; n: number; rate: number; ci95: [number, number]; target: number; verdict: "MET" | "NOT_MET" | "INCONCLUSIVE" }
interface Dash {
  generatedAt: string;
  hypotheses: {
    completion: Verdict;
    confidence: Verdict & { test: null | { n: number; meanPre: number; meanPost: number; meanDiff: number; t: number; df: number; pOneSided: number; cohensDz: number; ci95: [number, number] } };
  };
  feedbackSla: Verdict & { medianDays: number | null };
  funnel: { step: string; n: number }[];
  calibration: { globalMean: number; mentors: { id: string; name: string; reviews: number; meanRating: number | null; bias: number; label: string; activeLoad: number; capacity: number; meanTurnaroundDays: number | null }[] };
  sla: { id: string; mentor: string; learner: string; challenge: string; stage: string; state: string; daysLeft: number }[];
  aiAssistedShare: number;
  reassignments: number;
}

const VERDICT = { MET: "Target met", NOT_MET: "Below target", INCONCLUSIVE: "Not yet conclusive" };

/** Point estimate with its 95% interval, against the target line. */
function TargetBar({ v }: { v: Verdict }) {
  const x = (p: number) => 14 + p * 272;
  return (
    <svg viewBox="0 0 300 50" className="target-bar" role="img" aria-label={`${pct(v.rate)} (95% CI ${pct(v.ci95[0])} to ${pct(v.ci95[1])}); target ${pct(v.target)}`}>
      <line x1={x(0)} x2={x(1)} y1="26" y2="26" className="axis" />
      <rect x={x(v.ci95[0])} width={Math.max(2, x(v.ci95[1]) - x(v.ci95[0]))} y="20" height="12" rx="6" className="ci" />
      <circle cx={x(v.rate)} cy="26" r="6" className="point" />
      <line x1={x(v.target)} x2={x(v.target)} y1="14" y2="38" className="target" />
      <text x={Math.min(x(v.target), 250)} y="11" textAnchor="middle" className="lbl">target {pct(v.target)}</text>
      <text x={x(0)} y="49" className="lbl">0%</text>
      <text x={x(1)} y="49" textAnchor="end" className="lbl">100%</text>
    </svg>
  );
}

function HypothesisCard({ title, v, children }: { title: string; v: Verdict; children?: React.ReactNode }) {
  return (
    <Card className={`hypo verdict-${v.verdict.toLowerCase()}`}>
      <div className="row"><strong>{title}</strong><span className="tag">{VERDICT[v.verdict]}</span></div>
      <p className="big">{pct(v.rate)} <span className="small muted">({v.successes} of {v.n})</span></p>
      <TargetBar v={v} />
      {children}
    </Card>
  );
}

export function AdminDashboard() {
  const { data, error, loading, reload } = useLoad<Dash>("/api/admin/analytics");
  const [slaMsg, setSlaMsg] = useState("");
  const runSla = async () => {
    const r = await api<{ checked: number; warned: number; reassigned: number }>("POST", "/api/admin/sla/check");
    setSlaMsg(`Checked ${r.checked}: ${r.warned} warned, ${r.reassigned} reassigned.`);
    await reload();
  };
  if (loading) return <Page eyebrow="Admin" title="Pilot" accent="impact"><Loading /></Page>;
  if (!data) return <Page eyebrow="Admin" title="Pilot" accent="impact"><ErrorBox message={error} /></Page>;
  const t = data.hypotheses.confidence.test;
  const top = data.funnel[0]?.n || 1;

  return (
    <Page eyebrow="Kigali pilot · admin" title="Is the pilot" accent="working?" actions={<button className="btn" onClick={() => void download("/api/admin/surveys.csv", "dr-nath-surveys.csv")}>Export surveys (CSV)</button>}>
      <p className="small muted">Hypothesis tests from Part A, Section 7. Intervals are 95% (Wilson for rates, t for the mean change). Updated {fmtDate(data.generatedAt)}.</p>
      <div className="grid">
        <HypothesisCard title="H1: Active learners completing a project" v={data.hypotheses.completion} />
        <HypothesisCard title="H2: Learners reporting higher confidence" v={data.hypotheses.confidence}>
          {t ? (
            <p className="small">
              Mean confidence {t.meanPre.toFixed(2)} → {t.meanPost.toFixed(2)} (+{t.meanDiff.toFixed(2)}, 95% CI {t.ci95[0].toFixed(2)} to {t.ci95[1].toFixed(2)}).
              Paired t({t.df}) = {t.t.toFixed(2)}, one-sided p {t.pOneSided < 0.001 ? "< 0.001" : `= ${t.pOneSided.toFixed(3)}`}, effect size d<sub>z</sub> = {Number.isFinite(t.cohensDz) ? t.cohensDz.toFixed(2) : "n/a"}.
            </p>
          ) : (
            <p className="small muted">Needs at least 2 learners with both surveys.</p>
          )}
        </HypothesisCard>
        <HypothesisCard title="Feedback within 5 days" v={data.feedbackSla}>
          <p className="small">Median turnaround {data.feedbackSla.medianDays?.toFixed(1) ?? "n/a"} days · {data.reassignments} reassigned after a missed deadline · {pct(data.aiAssistedShare)} of feedback AI-assisted.</p>
        </HypothesisCard>
      </div>

      <h2>Learner funnel</h2>
      <Card>
        {data.funnel.map((f, i) => (
          <div key={f.step} className="funnel-row">
            <span className="small">{f.step}</span>
            <div className="funnel-bar"><div style={{ width: `${(f.n / top) * 100}%` }} /></div>
            <span className="small">{f.n}{i > 0 && data.funnel[i - 1]!.n > 0 ? ` (${pct(f.n / data.funnel[i - 1]!.n)})` : ""}</span>
          </div>
        ))}
      </Card>

      <h2>Mentors and rating calibration</h2>
      <Card>
        <p className="small muted">Bias = how far a mentor's ratings sit from the average {data.calibration.globalMean.toFixed(2)}, shrunk towards 0 when they have few reviews. Portfolios and recommendations use calibrated ratings.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mentor</th><th>Reviews</th><th>Mean</th><th>Bias</th><th>Style</th><th>Load</th><th>Avg days</th></tr></thead>
            <tbody>
              {data.calibration.mentors.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td><td>{m.reviews}</td><td>{m.meanRating?.toFixed(2) ?? "-"}</td>
                  <td>{m.bias >= 0 ? "+" : ""}{m.bias.toFixed(2)}</td>
                  <td><span className={`tag style-${m.label.toLowerCase()}`}>{m.label.toLowerCase()}</span></td>
                  <td className={m.activeLoad >= m.capacity ? "bad" : ""}>{m.activeLoad}/{m.capacity}</td>
                  <td>{m.meanTurnaroundDays?.toFixed(1) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="row">
        <h2>Reviews in progress</h2>
        <button className="btn" onClick={runSla}>Run SLA check now</button>
      </div>
      {slaMsg && <p className="notice">{slaMsg}</p>}
      <Card>
        {data.sla.length === 0 ? <Empty>No reviews in progress.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Learner</th><th>Work</th><th>Mentor</th><th>Status</th></tr></thead>
              <tbody>
                {data.sla.map((a) => (
                  <tr key={a.id}>
                    <td>{a.learner}</td><td className="small">{a.challenge} · {a.stage}</td><td>{a.mentor}</td>
                    <td><span className={`tag sla-${a.state.toLowerCase()}`}>{a.state === "BREACHED" ? `${Math.ceil(-a.daysLeft)}d overdue` : `${Math.floor(a.daysLeft)}d left`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

interface AdminChallenge { id: string; title: string; theme: string; status: string; difficulty: number; stageCount: number; skills: string[] }
const emptyStage = { title: "", brief: "", criteria: "" };

export function AdminChallenges() {
  const { data, error, loading, reload } = useLoad<AdminChallenge[]>("/api/challenges");
  const blank = { title: "", brief: "", theme: "AGRICULTURE", difficulty: 2, durationWeeks: 2, skills: "", prerequisites: [] as string[], stages: [{ ...emptyStage }] };
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState("");

  const setStatus = async (id: string, status: string) => {
    await api("PATCH", `/api/admin/challenges/${id}`, { status });
    await reload();
  };
  const close = () => {
    setCreating(false);
    setEditingId(null);
    setForm(blank);
    setErr("");
  };
  // FR9.1: load an existing challenge into the same form.
  const startEdit = async (id: string) => {
    const c = await api<{ title: string; brief: string; theme: string; difficulty: number; durationWeeks: number; skills: string[]; prerequisites: { id: string }[]; stages: { title: string; brief: string; criteria: string }[] }>("GET", `/api/challenges/${id}`);
    setForm({
      title: c.title,
      brief: c.brief,
      theme: c.theme,
      difficulty: c.difficulty,
      durationWeeks: c.durationWeeks,
      skills: c.skills.join(", "),
      prerequisites: c.prerequisites.map((p) => p.id),
      stages: c.stages.map((s) => ({ title: s.title, brief: s.brief, criteria: s.criteria })),
    });
    setEditingId(id);
    setCreating(true);
    setErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const create = async (e: FormEvent, status: "DRAFT" | "LIVE") => {
    e.preventDefault();
    setErr("");
    const payload = { ...form, skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean) };
    try {
      if (editingId) await api("PUT", `/api/admin/challenges/${editingId}`, payload);
      else await api("POST", "/api/admin/challenges", { ...payload, status });
      close();
      await reload();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  };
  const setStage = (i: number, k: keyof typeof emptyStage, v: string) => setForm({ ...form, stages: form.stages.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  return (
    <Page eyebrow="Admin" title="Manage" accent="challenges" actions={<button className="btn primary" onClick={() => (creating ? close() : setCreating(true))}>{creating ? "Cancel" : "New challenge"}</button>}>
      {creating && (
        <Card>
          <h2>{editingId ? "Edit challenge" : "New challenge"}</h2>
          <form onSubmit={(e) => create(e, "LIVE")}>
            <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
            <label>Problem brief<textarea rows={3} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} required /></label>
            <div className="row">
              <label>Theme<select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>{["AGRICULTURE", "HEALTH", "EDUCATION", "ICT"].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Level (1-5)<input type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} /></label>
              <label>Weeks<input type="number" min={1} max={26} value={form.durationWeeks} onChange={(e) => setForm({ ...form, durationWeeks: Number(e.target.value) })} /></label>
            </div>
            <label>Skills (comma-separated, used for matching and recommendations)<input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></label>
            <label>Prerequisites
              <select multiple value={form.prerequisites} onChange={(e) => setForm({ ...form, prerequisites: [...e.target.selectedOptions].map((o) => o.value) })}>
                {data?.filter((c) => c.id !== editingId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {form.stages.map((s, i) => (
              <fieldset key={i} className="stage-edit">
                <legend>Stage {i + 1}</legend>
                <input placeholder="Title" value={s.title} onChange={(e) => setStage(i, "title", e.target.value)} required />
                <textarea placeholder="What the learner does" rows={2} value={s.brief} onChange={(e) => setStage(i, "brief", e.target.value)} required />
                <textarea placeholder="Success criteria mentors check" rows={2} value={s.criteria} onChange={(e) => setStage(i, "criteria", e.target.value)} required />
              </fieldset>
            ))}
            <div className="row">
              <button type="button" className="link-btn" onClick={() => setForm({ ...form, stages: [...form.stages, { ...emptyStage }] })}>+ Add stage</button>
              {form.stages.length > 1 && (
                <button type="button" className="link-btn" onClick={() => setForm({ ...form, stages: form.stages.slice(0, -1) })}>Remove last stage</button>
              )}
            </div>
            <ErrorBox message={err} />
            <div className="row">
              {editingId ? (
                <button className="btn primary">Save changes</button>
              ) : (
                <>
                  <button className="btn primary">Publish</button>
                  <button type="button" className="btn" onClick={(e) => create(e, "DRAFT")}>Save as draft</button>
                </>
              )}
            </div>
          </form>
        </Card>
      )}
      {loading && <Loading />}
      <ErrorBox message={error} />
      {data?.map((c) => (
        <Card key={c.id}>
          <div className="row">
            <strong>{c.title}</strong>
            <span className={`tag status-${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
          </div>
          <p className="small muted">{c.theme} · level {c.difficulty} · {c.stageCount} stages · {c.skills.join(", ")}</p>
          <div className="row">
            {c.status !== "LIVE" && <button className="btn" onClick={() => setStatus(c.id, "LIVE")}>Publish</button>}
            {c.status === "LIVE" && <button className="btn" onClick={() => setStatus(c.id, "DRAFT")}>Unpublish</button>}
            <button className="btn" onClick={() => void startEdit(c.id)}>Edit</button>
            <button className="link-btn" onClick={() => confirm(`Archive "${c.title}"?`) && setStatus(c.id, "ARCHIVED")}>Archive</button>
          </div>
        </Card>
      ))}
    </Page>
  );
}

interface AdminUser { id: string; name: string; email: string; role: string; expertise: string[]; capacity: number; createdAt: string }

export function AdminUsers() {
  const { data, error, loading, reload } = useLoad<AdminUser[]>("/api/admin/users");
  const [q, setQ] = useState("");
  const update = async (id: string, body: Record<string, unknown>) => {
    await api("PATCH", `/api/admin/users/${id}`, body);
    await reload();
  };
  const shown = data?.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page eyebrow="Admin" title="People and" accent="roles">
      <input className="search" type="search" placeholder="Search users..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
      {loading && <Loading />}
      <ErrorBox message={error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Mentor capacity</th><th>Expertise</th></tr></thead>
          <tbody>
            {shown?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}<br /><span className="small muted">{u.email}</span></td>
                <td>
                  <select value={u.role} onChange={(e) => confirm(`Change ${u.name} to ${e.target.value}?`) && update(u.id, { role: e.target.value })} aria-label={`Role for ${u.name}`}>
                    <option>LEARNER</option><option>MENTOR</option><option>ADMIN</option>
                  </select>
                </td>
                <td>{u.role === "MENTOR" ? <input type="number" min={0} max={50} defaultValue={u.capacity} onBlur={(e) => Number(e.target.value) !== u.capacity && update(u.id, { capacity: Number(e.target.value) })} aria-label={`Capacity for ${u.name}`} /> : "-"}</td>
                <td className="small">{u.expertise.join(", ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

interface Audit {
  verification: { valid: boolean; entries: number; head?: string; brokenAt?: number; reason?: string };
  entries: { seq: number; ts: string; actor: string | null; action: string; entity: string; entity_id: string | null; data: Record<string, unknown>; hash: string }[];
}

export function AdminAudit() {
  const { data, error, loading } = useLoad<Audit>("/api/admin/audit?limit=200");
  return (
    <Page eyebrow="Tamper-evident" title="Audit" accent="log">
      {loading && <Loading />}
      <ErrorBox message={error} />
      {data && (
        <>
          <Card className={data.verification.valid ? "verified" : "unverified"}>
            {data.verification.valid ? (
              <p><strong>Chain intact.</strong> All {data.verification.entries} entries verified. Head hash <code>{data.verification.head?.slice(0, 16)}…</code></p>
            ) : (
              <p><strong>Tampering detected at entry #{data.verification.brokenAt}:</strong> {data.verification.reason}</p>
            )}
            <p className="small muted">Each entry's SHA-256 hash covers its content and the previous hash, so editing or deleting any past entry is detectable.</p>
          </Card>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.seq} className={data.verification.brokenAt === e.seq ? "bad" : ""}>
                    <td>{e.seq}</td>
                    <td className="small">{new Date(e.ts).toLocaleString()}</td>
                    <td className="small">{e.actor ?? "system"}</td>
                    <td><code>{e.action}</code></td>
                    <td className="small"><code>{JSON.stringify(e.data)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
