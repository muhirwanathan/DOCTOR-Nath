import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Icon } from "../components/icons";
import { Timeline } from "../components/dege";
import { ArrowButton, Card, Empty, ErrorBox, Hero, Loading, NumberedRow, Page, Progress, Section, themeLabel, useLoad } from "../components/ui";

interface Enrolment { id: string; challengeId: string; title: string; theme: string; currentStage: number; stageCount: number; progressPct: number; status: string }
interface Rec { challengeId: string; title: string; score: number; reasons: string[]; factors: Record<string, number> }
interface Recs { recommendations: Rec[]; locked: { challengeId: string; title: string; missing: string[] }[] }
interface SurveyState { done: { type: string }[]; postAvailable: boolean }

export function LearnerHome() {
  const { user } = useAuth();
  const { t } = useI18n();
  const enrolments = useLoad<Enrolment[]>("/api/enrolments");
  const recs = useLoad<Recs>("/api/recommendations");
  const surveys = useLoad<SurveyState>("/api/surveys");
  const needsPre = surveys.data && !surveys.data.done.some((d) => d.type === "PRE");
  const done = enrolments.data?.filter((e) => e.status === "COMPLETED").length ?? 0;
  const active = enrolments.data?.filter((e) => e.status === "ACTIVE") ?? [];
  const next = active[0];

  return (
    <>
      <Hero
        eyebrow="Your workspace"
        title={`Hi ${user?.name.split(" ")[0]}, keep`}
        accent="building."
        lead={next ? `You are on stage ${next.currentStage} of ${next.stageCount} in "${next.title}".` : "Pick a challenge built on a real Rwandan problem and start your first stage."}
        aside={
          <div className="glass">
            <div className="stat">{done}</div>
            <div className="stat-label">{done === 1 ? "challenge completed" : "challenges completed"}</div>
            <ul className="stat-list">
              <li>{active.length} in progress</li>
              <li>{recs.data?.recommendations.length ?? 0} recommended next</li>
              <li><Link to="/portfolio" style={{ color: "inherit" }}>View your badges</Link></li>
            </ul>
          </div>
        }
      >
        {next ? <ArrowButton to={`/challenges/${next.challengeId}`}>{t("continue")}</ArrowButton> : <ArrowButton to="/challenges">Browse challenges</ArrowButton>}
      </Hero>

      <main className="page">
        {needsPre && (
          <Card className="callout">
            <h3>Start with a one-minute survey</h3>
            <p className="small">It records how confident you feel now, so you can see how much you grow.</p>
            <Link className="btn primary" to="/survey/PRE">Take the survey</Link>
          </Card>
        )}
        {surveys.data?.postAvailable && (
          <Card className="callout">
            <h3>You finished a challenge</h3>
            <p className="small">Take the follow-up survey to measure your progress.</p>
            <Link className="btn primary" to="/survey/POST">Take the survey</Link>
          </Card>
        )}

        <Section eyebrow="In progress" title={t("myChallenges")}>
          {enrolments.loading && <Loading />}
          <ErrorBox message={enrolments.error} />
          {enrolments.data?.length === 0 && <Empty>You have not joined a challenge yet. <Link to="/challenges">Browse challenges</Link></Empty>}
          <div className="grid">
            {enrolments.data?.map((e) => (
              <Link key={e.id} to={`/challenges/${e.challengeId}`} className="card">
                <div className="row">
                  <span className="tag">{themeLabel(e.theme)}</span>
                  <span className={`tag ${e.status === "COMPLETED" ? "good" : ""}`}>{e.status === "COMPLETED" ? "Completed" : `${t("stage")} ${e.currentStage} ${t("of")} ${e.stageCount}`}</span>
                </div>
                <h3 style={{ marginTop: "1rem" }}>{e.title}</h3>
                <Progress pct={e.progressPct} label={`${e.title} progress`} />
              </Link>
            ))}
          </div>
        </Section>

        <Section eyebrow="Picked for you" title="What to take" accent="on next">
          {recs.loading && <Loading />}
          <ErrorBox message={recs.error} />
          {recs.data?.recommendations.length === 0 && <Empty>No new challenges to recommend right now.</Empty>}
          <div className="nrows">
            {recs.data?.recommendations.map((r, i) => (
              <NumberedRow
                key={r.challengeId}
                n={i + 1}
                to={`/challenges/${r.challengeId}`}
                title={r.title}
                meta={r.reasons.slice(0, 2).join(" · ")}
                tag={<span className="tag">{Math.round(r.score * 100)}% match</span>}
              />
            ))}
          </div>
          {!!recs.data?.locked.length && (
            <p className="small muted" style={{ marginTop: "1rem" }}>
              Unlock later: {recs.data.locked.map((l) => `${l.title} (after ${l.missing.join(", ")})`).join("; ")}
            </p>
          )}
        </Section>
      </main>
    </>
  );
}

interface ChallengeCard { id: string; title: string; theme: string; difficulty: number; durationWeeks: number; stageCount: number; skills: string[]; locked: boolean; status: string; enrolment: { status: string; progressPct: number } | null }
const THEMES = ["AGRICULTURE", "HEALTH", "EDUCATION", "ICT"];

export function Challenges() {
  const { t } = useI18n();
  const [theme, setTheme] = useState("");
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ ...(theme ? { theme } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const { data, error, loading } = useLoad<ChallengeCard[]>(`/api/challenges?${params}`);
  return (
    <Page eyebrow="Challenge library" title="Real problems from" accent="Rwandan communities" lead="Each challenge is a brief from a cooperative, clinic, school or employer, broken into stages a mentor reviews.">
      <input className="search" type="search" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
      <div className="chips" role="group" aria-label="Filter by theme">
        <button className={`chip ${!theme ? "on" : ""}`} onClick={() => setTheme("")}>{t("all")}</button>
        {THEMES.map((th) => (
          <button key={th} className={`chip ${theme === th ? "on" : ""}`} onClick={() => setTheme(th)}>{themeLabel(th)}</button>
        ))}
      </div>
      {loading && <Loading />}
      <ErrorBox message={error} />
      {data?.length === 0 && <Empty>No challenges match.</Empty>}
      <div className="nrows">
        {data?.map((c, i) => (
          <NumberedRow
            key={c.id}
            n={i + 1}
            to={`/challenges/${c.id}`}
            dim={c.locked}
            title={c.title}
            meta={`${themeLabel(c.theme)} · ${c.stageCount} stages · ${c.durationWeeks} weeks · level ${c.difficulty} · ${c.skills.join(", ")}`}
            tag={c.enrolment ? <span className="tag good">{c.enrolment.status === "COMPLETED" ? "Done" : `${c.enrolment.progressPct}%`}</span> : c.locked ? <span className="tag">Locked</span> : undefined}
          />
        ))}
      </div>
    </Page>
  );
}

interface ChallengeDetailData {
  id: string; title: string; brief: string; theme: string; difficulty: number; durationWeeks: number; skills: string[];
  prerequisites: { id: string; title: string; done: boolean }[];
  enrolment: { id: string; currentStage: number; progressPct: number; status: string } | null;
  stages: { id: string; sequence: number; title: string; brief: string; criteria: string; unlocked: boolean; latestSubmission: { status: string; version: number } | null }[];
}

const STATUS_LABEL: Record<string, string> = { SUBMITTED: "With a mentor", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved" };

export function ChallengeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad<ChallengeDetailData>(`/api/challenges/${id}`);
  const [enrolError, setEnrolError] = useState("");

  const enrol = async () => {
    setEnrolError("");
    try {
      await api("POST", `/api/challenges/${id}/enrol`);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.details?.needsSurvey) return nav(`/survey/PRE?next=/challenges/${id}`);
      setEnrolError((err as Error).message);
    }
  };

  if (loading) return <main className="page"><Loading /></main>;
  if (!data) return <main className="page"><ErrorBox message={error} /></main>;
  const locked = data.prerequisites.some((p) => !p.done);
  const words = data.title.split(" ");

  return (
    <>
      <Hero
        eyebrow={`${themeLabel(data.theme)} · level ${data.difficulty} · ${data.durationWeeks} weeks`}
        title={words.slice(0, -2).join(" ") || data.title}
        accent={words.length > 2 ? words.slice(-2).join(" ") : undefined}
        lead={data.brief}
        watermark={themeLabel(data.theme).toLowerCase()}
        aside={
          <div className="glass">
            <div className="stat">{data.enrolment ? `${data.enrolment.progressPct}%` : data.stages.length}</div>
            <div className="stat-label">{data.enrolment ? "complete" : "stages, each reviewed by a mentor"}</div>
            <ul className="stat-list">
              <li>Skills: {data.skills.join(", ")}</li>
              {data.prerequisites.map((p) => <li key={p.id}>{p.done ? "Done:" : "Requires:"} {p.title}</li>)}
            </ul>
          </div>
        }
      >
        {user?.role === "LEARNER" && !data.enrolment && (
          <ArrowButton onClick={enrol} disabled={locked}>{locked ? "Finish the required challenges first" : t("enrol")}</ArrowButton>
        )}
        <ErrorBox message={enrolError} />
      </Hero>

      <main className="page">
        <Link to="/challenges" className="link-btn"><Icon name="arrowLeft" size={16} /> All challenges</Link>
        <Section eyebrow="The journey" title="Stage" accent="roadmap">
          <Timeline
            items={data.stages.map((s) => {
              const enrolled = user?.role === "LEARNER" && !!data.enrolment;
              const approved = s.latestSubmission?.status === "APPROVED";
              const state = approved ? "done" : s.unlocked && (enrolled || user?.role !== "LEARNER") ? "current" : "todo";
              return {
                key: s.id,
                when: `Stage ${String(s.sequence).padStart(2, "0")}${s.latestSubmission ? ` · ${STATUS_LABEL[s.latestSubmission.status]}` : ""}`,
                title: s.title,
                state,
                body: <>{s.brief}<br /><strong>Criteria:</strong> {s.criteria}</>,
                action: enrolled && s.unlocked ? (
                  <Link className={`btn ${approved ? "" : "primary"}`} to={`/stages/${s.id}?challenge=${data.id}`}>
                    {approved ? "View" : s.latestSubmission ? "Open" : t("continue")} <Icon name="arrowRight" size={16} />
                  </Link>
                ) : undefined,
              };
            })}
          />
        </Section>
      </main>
    </>
  );
}
