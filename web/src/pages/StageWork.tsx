import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fileToBase64 } from "../api";
import { useI18n } from "../i18n";
import { clearDraft, loadDraft, resolveConflict, saveLocal, syncDraft, type Conflict } from "../offline/drafts";
import { sendOrQueue } from "../offline/outbox";
import { Card, ErrorBox, fmtDate, Loading, Page, Stars, useLoad } from "../components/ui";
import { Icon } from "../components/icons";
import { CountBadge, Timeline } from "../components/dege";

interface Stage { id: string; sequence: number; title: string; brief: string; criteria: string }
interface Submission {
  id: string; version: number; status: string; content: string; fileName: string | null; fileUrl: string | null; submittedAt: string;
  feedback: { strengths: string; improvements: string; rating: number; criteriaMet: boolean; createdAt: string } | null;
}

type SaveState = "idle" | "local" | "syncing" | "synced" | "merged" | "offline" | "conflict";
const MAX_BYTES = 10 * 1024 * 1024;

export default function StageWork() {
  const { stageId = "" } = useParams();
  const [search] = useSearchParams();
  const challengeId = search.get("challenge");
  const { t } = useI18n();
  const challenge = useLoad<{ title: string; stages: Stage[]; stagesCount?: number }>(challengeId ? `/api/challenges/${challengeId}` : null);
  const history = useLoad<Submission[]>(`/api/stages/${stageId}/submissions`);
  const stage = challenge.data?.stages.find((s) => s.id === stageId);

  const [content, setContent] = useState("");
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolution, setResolution] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    loadDraft(stageId)
      .then((d) => {
        setContent(d.content);
        setSave(d.dirty ? "local" : "idle");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setReady(true));
  }, [stageId]);

  const runSync = async () => {
    setSave("syncing");
    try {
      const r = await syncDraft(stageId);
      if (r.status === "offline") return setSave("offline");
      if (r.status === "conflict") {
        setConflict(r.conflict);
        setResolution(r.conflict.preview);
        return setSave("conflict");
      }
      if (r.merged) setContent(r.draft.content);
      setSave(r.merged ? "merged" : "synced");
    } catch (e) {
      setError((e as Error).message);
      setSave("local");
    }
  };

  useEffect(() => {
    const online = () => void runSync();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  });

  const onEdit = async (text: string) => {
    setContent(text);
    await saveLocal(stageId, text);
    setSave("local");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void runSync(), 1500);
  };

  const applyResolution = async () => {
    if (!conflict) return;
    if (/^(<<<<<<<|=======|>>>>>>>)/m.test(resolution)) return setError("Remove the conflict markers (<<<, ===, >>>) before saving.");
    setError("");
    setContent(resolution);
    const r = await resolveConflict(stageId, resolution, conflict);
    setConflict(null);
    setSave(r.status === "synced" ? "synced" : r.status === "offline" ? "offline" : "conflict");
  };

  const latest = history.data?.[0];
  const canSubmit = !latest || latest.status === "CHANGES_REQUESTED";

  const submit = async () => {
    setError("");
    setNotice("");
    if (!content.trim()) return setError("Describe your solution before submitting.");
    if (file && file.size > MAX_BYTES) return setError("Files are limited to 10 MB.");
    setBusy(true);
    try {
      const body = { content, ...(file ? { file: { name: file.name, dataBase64: await fileToBase64(file) } } : {}) };
      const r = await sendOrQueue(`POST`, `/api/stages/${stageId}/submissions`, body, `${challenge.data?.title ?? "Stage"}: ${stage?.title ?? "submission"}`);
      await clearDraft(stageId);
      setFile(null);
      if ("queued" in r) {
        setNotice("You are offline. Your submission is saved on this phone and will be sent automatically when you reconnect.");
      } else {
        setNotice("Submitted. A mentor has been matched to your work and you will be notified when feedback is ready.");
        setContent("");
        await history.reload();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveLabel: Record<SaveState, string> = {
    idle: "",
    local: t("savedOffline"),
    syncing: "Saving...",
    synced: t("synced"),
    merged: "Saved: merged with edits from your other device",
    offline: `${t("savedOffline")}, will sync when online`,
    conflict: "Edited on another device: choose what to keep",
  };

  return (
    <Page eyebrow={stage ? `${t("stage")} ${stage.sequence} · ${challenge.data?.title ?? ""}` : t("stage")} title={stage?.title ?? "Stage"}>
      {challengeId && <Link to={`/challenges/${challengeId}`} className="link-btn"><Icon name="arrowLeft" size={16} /> {challenge.data?.title ?? "Back"}</Link>}
      {stage && (
        <Card>
          <h2>Brief</h2>
          <p>{stage.brief}</p>
          <p className="small muted"><strong>Success criteria:</strong> {stage.criteria}</p>
        </Card>
      )}

      {conflict && (
        <Card className="conflict">
          <h2>This draft was also changed on another device</h2>
          <p className="small">Some edits overlap. Choose a side for each, or edit the text below, then save.</p>
          {conflict.conflicts.map((c, i) => (
            <div key={i} className="conflict-pair">
              <div><strong>This device</strong><pre>{c.local || "(empty)"}</pre><button className="btn" onClick={() => setResolution((r) => r.replace(/<<<<<<< this device\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> other device/, (_m, a) => a))}>Keep this</button></div>
              <div><strong>Other device</strong><pre>{c.remote || "(empty)"}</pre><button className="btn" onClick={() => setResolution((r) => r.replace(/<<<<<<< this device\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> other device/, (_m, _a, b) => b))}>Keep that</button></div>
            </div>
          ))}
          <textarea rows={8} value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label="Resolved text" />
          <button className="btn primary" onClick={applyResolution}>Save this version</button>
        </Card>
      )}

      {canSubmit ? (
        <Card>
          <h2>{latest ? `Revise (version ${latest.version + 1})` : "Your submission"}</h2>
          {!ready ? (
            <Loading />
          ) : (
            <textarea rows={10} value={content} onChange={(e) => void onEdit(e.target.value)} placeholder="Describe your solution. Add links to photos, documents or videos." aria-label="Your submission" disabled={!!conflict} />
          )}
          <p className="small muted" aria-live="polite">{saveLabel[save]}</p>
          <label className="file">
            + Add file (max 10 MB)
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.pptx,.xlsx,.csv,.zip" />
          </label>
          {file && <p className="small">Attached: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
          <button className="btn primary wide" onClick={submit} disabled={busy || !!conflict}>{busy ? "..." : t("submit")}</button>
        </Card>
      ) : (
        <Card className="callout">{latest?.status === "APPROVED" ? "This stage is approved. Well done!" : "Your latest version is with a mentor. You will be notified when feedback is ready."}</Card>
      )}
      <ErrorBox message={error} />
      {notice && <p className="notice" role="status">{notice}</p>}

      <h2>History <CountBadge n={history.data?.length ?? 0} soft /></h2>
      {history.loading && <Loading />}
      <ErrorBox message={history.error} />
      {history.data && history.data.length > 0 && (
        <Timeline
          items={history.data.map((s) => ({
            key: s.id,
            when: `${fmtDate(s.submittedAt)} · ${s.status.replace("_", " ").toLowerCase()}`,
            title: `Version ${s.version}`,
            state: s.status === "APPROVED" ? "done" : s.status === "SUBMITTED" ? "current" : "todo",
            body: (
              <div className="history">
                <p className="pre">{s.content}</p>
                {s.fileUrl && <a className="link-btn small" href={s.fileUrl}><Icon name="clip" size={14} /> {s.fileName}</a>}
                {s.feedback && (
                  <div className="feedback">
                    <Stars value={s.feedback.rating} />
                    <p><strong>Strengths:</strong> {s.feedback.strengths}</p>
                    <p><strong>To improve:</strong> {s.feedback.improvements}</p>
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </Page>
  );
}
