import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/icons";
import { Countdown } from "../components/dege";
import { Card, Empty, ErrorBox, fmtDate, Hero, Loading, NumberedRow, Page, pct, Section, useLoad } from "../components/ui";

interface QueueItem {
  assignmentId: string; submissionId: string; learner: { name: string }; challenge: string; theme: string;
  stage: { title: string; sequence: number }; version: number; assignedAt: string; dueAt: string;
  sla: "ON_TRACK" | "AT_RISK" | "BREACHED"; match: { score: number; factors: Record<string, number> };
}

const SLA_LABEL = { ON_TRACK: "On track", AT_RISK: "Due soon", BREACHED: "Overdue" };
const daysLeft = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);

export function MentorQueue() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad<QueueItem[]>("/api/mentor/queue");
  const dueSoon = data?.filter((q) => q.sla !== "ON_TRACK").length ?? 0;
  return (
    <>
      <Hero
        eyebrow="Mentor workspace"
        title={`Welcome back, ${user?.name.split(" ")[0]}. Your`}
        accent="review queue."
        lead="Submissions are matched to you by expertise, language, workload and turnaround. Learners are waiting on your feedback: aim for 5 days."
        aside={
          <div className="glass">
            <div className="stat">{data?.length ?? 0}</div>
            <div className="stat-label">submissions waiting for you</div>
            <ul className="stat-list"><li>{dueSoon} due soon or overdue</li></ul>
          </div>
        }
      />
      <main className="page">
        <Section eyebrow="To review" title="Oldest deadline" accent="first">
          {loading && <Loading />}
          <ErrorBox message={error} />
          {data?.length === 0 && <Empty>Your queue is empty. Thank you for your reviews!</Empty>}
          <div className="nrows">
            {data?.map((q, i) => (
              <NumberedRow
                key={q.assignmentId}
                n={i + 1}
                to={`/review/${q.submissionId}`}
                title={`${q.learner.name}: ${q.challenge}`}
                meta={
                  <>
                    Stage {q.stage.sequence}, {q.stage.title} · version {q.version}{q.version > 1 ? " (resubmission)" : ""} · due {fmtDate(q.dueAt)} · match {pct(q.match.score)}
                    {q.match.factors.continuity ? ", reviewed the previous version" : ""}
                  </>
                }
                tag={<span className={`tag sla-${q.sla.toLowerCase()}`}>{q.sla === "BREACHED" ? `${-daysLeft(q.dueAt)}d overdue` : q.sla === "AT_RISK" ? `${daysLeft(q.dueAt)}d left` : SLA_LABEL[q.sla]}</span>}
              />
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}

interface Review { learnerName: string; challenge: { title: string }; stage: { title: string; brief: string; criteria: string }; canReview: boolean; dueAt: string | null }
interface Sub { id: string; version: number; status: string; content: string; fileName: string | null; fileUrl: string | null; submittedAt: string }
interface Diff { previousVersion: number | null; previousImprovements?: string | null; parts: { value: string; added: boolean; removed: boolean }[] }
interface Draft { strengths: string; improvements: string; suggestedRating: number; criteriaMet: boolean; criteriaCheck: { criterion: string; met: boolean; note: string }[] }

export function MentorReview() {
  const { submissionId } = useParams();
  const nav = useNavigate();
  const ctx = useLoad<Review>(`/api/mentor/review/${submissionId}`);
  const sub = useLoad<Sub>(`/api/submissions/${submissionId}`);
  const diff = useLoad<Diff>(`/api/submissions/${submissionId}/diff`);
  const [form, setForm] = useState({ strengths: "", improvements: "", rating: 0, criteriaMet: false });
  const [aiUsed, setAiUsed] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [checks, setChecks] = useState<Draft["criteriaCheck"]>([]);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(true);

  const draft = async () => {
    setAiBusy(true);
    setError("");
    try {
      const d = await api<Draft>("POST", `/api/submissions/${submissionId}/ai-draft`);
      setForm({ strengths: d.strengths, improvements: d.improvements, rating: d.suggestedRating, criteriaMet: d.criteriaMet });
      setChecks(d.criteriaCheck);
      setAiUsed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const send = async () => {
    setError("");
    if (!form.rating) return setError("Choose a rating from 1 to 5.");
    try {
      const r = await api<{ outcome: string; completed?: boolean }>("POST", `/api/submissions/${submissionId}/feedback`, { ...form, aiAssisted: aiUsed });
      alert(r.outcome === "APPROVED" ? (r.completed ? "Approved. The learner completed the challenge and earned a badge." : "Approved. The next stage is unlocked for the learner.") : "Feedback sent. The learner can revise and resubmit.");
      nav("/");
    } catch (e) {
      setError(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f: { field: string; message: string }) => `${f.field}: ${f.message}`).join("; ") : (e as Error).message);
    }
  };

  if (ctx.loading || sub.loading) return <Page title="Review"><Loading /></Page>;
  if (!ctx.data || !sub.data) return <Page title="Review"><ErrorBox message={ctx.error ?? sub.error} /></Page>;
  const s = sub.data;

  return (
    <Page eyebrow={`Version ${s.version} · ${ctx.data.challenge.title}`} title="Review" accent={`${ctx.data.learnerName.split(" ")[0]}'s work`}>
      {ctx.data.canReview && ctx.data.dueAt && <Countdown to={ctx.data.dueAt} label="Feedback due in" />}
      <Card>
        <strong>{ctx.data.learnerName}: {ctx.data.challenge.title}</strong>
        <p className="small muted">{ctx.data.stage.title} · version {s.version} · submitted {fmtDate(s.submittedAt)}</p>
        <p className="small">{ctx.data.stage.brief}</p>
        <p className="small"><strong>Success criteria:</strong> {ctx.data.stage.criteria}</p>
      </Card>

      <Card>
        <div className="row">
          <h2>Submission</h2>
          {diff.data?.previousVersion && (
            <button className="link-btn small" onClick={() => setShowDiff(!showDiff)}>{showDiff ? "Show plain text" : `Show changes since v${diff.data.previousVersion}`}</button>
          )}
        </div>
        {diff.data?.previousVersion && showDiff ? (
          <>
            {diff.data.previousImprovements && <p className="small muted">Last time you asked for: {diff.data.previousImprovements}</p>}
            <p className="pre diff">
              {diff.data.parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
            </p>
          </>
        ) : (
          <p className="pre">{s.content}</p>
        )}
        {s.fileUrl && <a className="btn" href={s.fileUrl}><Icon name="clip" size={16} />{s.fileName}</a>}
      </Card>

      {ctx.data.canReview ? (
        <Card>
          <div className="row">
            <h2>Your feedback</h2>
            <button className="btn" onClick={draft} disabled={aiBusy}><Icon name="spark" size={16} />{aiBusy ? "Drafting..." : "Draft with AI"}</button>
          </div>
          {aiUsed && <p className="small notice">AI draft loaded. Check and edit it before sending: you are responsible for the feedback.</p>}
          {checks.length > 0 && (
            <ul className="criteria">
              {checks.map((c) => <li key={c.criterion} className={c.met ? "met" : "unmet"}><Icon name={c.met ? "check" : "x"} size={16} /><span><strong>{c.criterion}</strong>: {c.note}</span></li>)}
            </ul>
          )}
          <fieldset className="rating">
            <legend>Rating</legend>
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} type="button" className={`dot-btn ${form.rating >= r ? "on" : ""}`} aria-label={`${r} of 5`} aria-pressed={form.rating === r} onClick={() => setForm({ ...form, rating: r })} />
            ))}
          </fieldset>
          <label>Strengths<textarea rows={3} value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></label>
          <label>To improve<textarea rows={3} value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={form.criteriaMet} onChange={(e) => setForm({ ...form, criteriaMet: e.target.checked })} />
            Meets all success criteria (approves the stage{form.criteriaMet ? "; may award a badge" : ""})
          </label>
          <ErrorBox message={error} />
          <button className="btn primary wide" onClick={send}>Send feedback</button>
        </Card>
      ) : (
        <Card className="callout">This submission is no longer assigned to you.</Card>
      )}
    </Page>
  );
}
