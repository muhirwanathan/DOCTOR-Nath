import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { discard, flush, onOutboxChange, queued, sendOrQueue, type QueuedRequest } from "../offline/outbox";
import { Card, Empty, ErrorBox, fmtDate, Loading, Page, useLoad } from "../components/ui";
import { CountBadge, TokenRow } from "../components/dege";
import { type IconName } from "../components/icons";

const SCALE = ["Not at all", "A little", "Somewhat", "Mostly", "Completely"];

export function Survey() {
  const { type = "PRE" } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const { data, error, loading } = useLoad<{ questions: string[]; done: { type: string }[] }>("/api/surveys");
  const [answers, setAnswers] = useState<number[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const already = data?.done.some((d) => d.type === type);

  const submit = async () => {
    if (!data || answers.filter(Boolean).length !== data.questions.length) return setErr("Please answer every question.");
    try {
      const r = await sendOrQueue("POST", "/api/surveys", { type, answers }, `${type === "PRE" ? "Pre" : "Post"}-programme survey`);
      if ("queued" in r) setMsg("Saved offline. It will be sent when you reconnect.");
      else nav(search.get("next") ?? "/");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Page eyebrow="1-minute survey" title={type === "PRE" ? "Before you" : "How far you"} accent={type === "PRE" ? "start" : "have come"}>
      {loading && <Loading />}
      <ErrorBox message={error} />
      {already && <Card className="callout">You have already taken this survey. Thank you!</Card>}
      {data && !already && (
        <Card>
          <p className="small muted">How much do you agree? Your answers are used only to measure the programme's impact.</p>
          {data.questions.map((q, i) => (
            <fieldset key={q} className="likert">
              <legend>{i + 1}. {q}</legend>
              <div className="likert-row">
                {SCALE.map((label, v) => (
                  <label key={label} className={`chip ${answers[i] === v + 1 ? "on" : ""}`}>
                    <input type="radio" name={`q${i}`} checked={answers[i] === v + 1} onChange={() => setAnswers((a) => Object.assign([...a], { [i]: v + 1 }))} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <ErrorBox message={err} />
          {msg && <p className="notice">{msg}</p>}
          <button className="btn primary wide" onClick={submit}>Submit</button>
        </Card>
      )}
    </Page>
  );
}

export function Notifications() {
  const { t } = useI18n();
  const { data, error, loading } = useLoad<{ id: string; subject: string; message: string; read: boolean; createdAt: string }[]>("/api/notifications");
  useEffect(() => {
    if (data?.some((n) => !n.read)) void api("POST", "/api/notifications/read-all").catch(() => {});
  }, [data]);
  const unread = data?.filter((n) => !n.read).length ?? 0;
  const iconFor = (subject: string): IconName =>
    /badge/i.test(subject) ? "award" : /feedback|approved/i.test(subject) ? "check" : /due|missed|SLA/i.test(subject) ? "bell" : /challenge/i.test(subject) ? "grid" : "list";
  return (
    <Page eyebrow="Inbox" title={t("notifications")} actions={<CountBadge n={unread} />}>
      {loading && <Loading />}
      <ErrorBox message={error} />
      {data?.length === 0 && <Empty>No notifications yet.</Empty>}
      {!!data?.length && (
        <div className="token-list">
          {data.map((n) => (
            <TokenRow
              key={n.id}
              icon={iconFor(n.subject)}
              accent={!n.read}
              title={n.subject}
              caption={n.message}
              value={<span className="small muted">{fmtDate(n.createdAt)}</span>}
              sub={n.read ? undefined : "New"}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

export function Profile() {
  const { user, refresh, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [skills, setSkills] = useState((user?.role === "MENTOR" ? user.expertise : user?.skills ?? []).join(", "));
  const [msg, setMsg] = useState("");
  const [outbox, setOutbox] = useState<QueuedRequest[]>([]);

  useEffect(() => {
    const load = () => void queued().then(setOutbox);
    load();
    return onOutboxChange(load);
  }, []);

  if (!user) return null;
  const save = async () => {
    const list = skills.split(",").map((s) => s.trim()).filter(Boolean);
    await api("PATCH", "/api/me", { language: lang, ...(user.role === "MENTOR" ? { expertise: list } : { skills: list }) });
    await refresh();
    setMsg("Saved.");
  };
  const remove = async () => {
    if (!confirm("Delete your account and all your work permanently? This cannot be undone.")) return;
    await api("DELETE", "/api/me");
    logout();
  };

  return (
    <Page eyebrow="Account" title="Your" accent="profile">
      <Card>
        <p><strong>{user.name}</strong> · {user.role.toLowerCase()}</p>
        <p className="small muted">{user.email}{user.phone ? ` · ${user.phone}` : ""}</p>
        <label>
          {t("language")}
          <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "rw")}>
            <option value="en">English</option>
            <option value="rw">Kinyarwanda</option>
          </select>
        </label>
        <label>
          {user.role === "MENTOR" ? "Expertise (used to match you with submissions)" : "Skills you already have"}
          <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="e.g. AGRICULTURE, prototyping, sms" />
        </label>
        <button className="btn primary" onClick={save}>Save</button>
        {msg && <p className="notice">{msg}</p>}
      </Card>

      <h2>Offline queue</h2>
      <Card>
        {outbox.length === 0 ? (
          <p className="small muted">Nothing waiting to send. Work you submit offline appears here until it is delivered.</p>
        ) : (
          <>
            {outbox.map((o) => (
              <div key={o.key} className="row queue-item">
                <span className="small">{o.label} · {fmtDate(o.createdAt)}</span>
                {o.error ? <span className="small error">{o.error}</span> : <span className="tag">waiting</span>}
                <button className="link-btn small" onClick={() => void discard(o.key)}>Remove</button>
              </div>
            ))}
            <button className="btn" onClick={() => void flush()}>Send now</button>
          </>
        )}
      </Card>

      <h2>Your data</h2>
      <Card>
        <p className="small">Under Rwanda's data protection law (No 058/2021) you can delete your account and data at any time.</p>
        <button className="btn danger" onClick={remove}>Delete my account</button>
      </Card>
    </Page>
  );
}
