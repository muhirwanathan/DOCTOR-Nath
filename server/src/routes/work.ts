import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { diffWords } from "diff";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { db, id, now } from "../db.js";
import { checkFileSignature, forbidden, HttpError, idempotent, notFound, parse, requireAuth, signedFileUrl, type AuthUser } from "../http.js";
import { threeWayMerge } from "../lib/merge.js";
import { assignSubmission } from "../services/assign.js";
import { audit } from "../services/audit.js";

interface SubmissionRow {
  id: string;
  enrolment_id: string;
  stage_id: string;
  user_id: string;
  content: string;
  file_path: string | null;
  version: number;
  status: string;
  submitted_at: string;
}

const ALLOWED_TYPES = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".docx", ".pptx", ".xlsx", ".csv", ".zip"]);

/** Owner, admin, or a mentor assigned to this learner's work on this stage. */
export function canView(user: AuthUser, s: Pick<SubmissionRow, "user_id" | "stage_id">) {
  if (user.role === "ADMIN" || user.sub === s.user_id) return true;
  if (user.role !== "MENTOR") return false;
  return !!db().get(
    `SELECT 1 FROM assignments a JOIN submissions x ON x.id = a.submission_id WHERE a.mentor_id = ? AND x.user_id = ? AND x.stage_id = ?`,
    user.sub,
    s.user_id,
    s.stage_id,
  );
}

export function submissionDto(s: SubmissionRow) {
  const fb = db().get<{ strengths: string; improvements: string; rating: number; criteria_met: number; created_at: string; ai_assisted: number }>(
    "SELECT * FROM feedback WHERE submission_id = ?",
    s.id,
  );
  return {
    id: s.id,
    stageId: s.stage_id,
    version: s.version,
    status: s.status,
    content: s.content,
    fileName: s.file_path ? basename(s.file_path).replace(/^[0-9a-f-]{36}-/, "") : null,
    fileUrl: s.file_path ? signedFileUrl(s.id) : null,
    submittedAt: s.submitted_at,
    feedback: fb
      ? { strengths: fb.strengths, improvements: fb.improvements, rating: fb.rating, criteriaMet: !!fb.criteria_met, createdAt: fb.created_at, aiAssisted: !!fb.ai_assisted }
      : null,
  };
}

function stageForLearner(userId: string, stageId: string) {
  const row = db().get<{ sequence: number; challenge_id: string; enrolment_id: string; current_stage: number; status: string }>(
    `SELECT st.sequence, st.challenge_id, e.id enrolment_id, e.current_stage, e.status FROM stages st
     JOIN enrolments e ON e.challenge_id = st.challenge_id AND e.user_id = ? WHERE st.id = ?`,
    userId,
    stageId,
  );
  if (!row) throw new HttpError(403, "Enrol in this challenge first");
  if (row.sequence > row.current_stage) throw new HttpError(403, "This stage is still locked. Finish the previous stage first.");
  return row;
}

const SubmissionInput = z.object({
  content: z.string().trim().min(1, "describe your solution").max(20_000),
  file: z
    .object({
      name: z.string().min(1).max(200),
      dataBase64: z.string().max(Math.ceil((config.maxUploadBytes * 4) / 3) + 4, "files are limited to 10 MB"),
    })
    .optional(),
});

export default async function workRoutes(app: FastifyInstance) {
  app.get("/api/drafts/:stageId", { preHandler: requireAuth("LEARNER") }, async (req) => {
    const { stageId } = req.params as { stageId: string };
    const d = db().get<{ content: string; version: number; updated_at: string }>("SELECT content, version, updated_at FROM drafts WHERE user_id = ? AND stage_id = ?", req.user.sub, stageId);
    return d ? { content: d.content, version: d.version, updatedAt: d.updated_at } : { content: "", version: 0, updatedAt: null };
  });

  // Optimistic concurrency + three-way merge for drafts edited on more than one device.
  app.put("/api/drafts/:stageId", { preHandler: requireAuth("LEARNER") }, async (req, reply) => {
    const { stageId } = req.params as { stageId: string };
    const body = parse(z.object({ content: z.string().max(20_000), baseVersion: z.number().int().min(0), baseContent: z.string().max(20_000) }), req.body);
    stageForLearner(req.user.sub, stageId);
    const d = db();
    return d.tx(() => {
      const current = d.get<{ content: string; version: number }>("SELECT content, version FROM drafts WHERE user_id = ? AND stage_id = ?", req.user.sub, stageId);
      const save = (content: string, merged: boolean) => {
        const version = (current?.version ?? 0) + 1;
        if (current) d.run("UPDATE drafts SET content = ?, version = ?, updated_at = ? WHERE user_id = ? AND stage_id = ?", content, version, now(), req.user.sub, stageId);
        else d.insert("drafts", { id: id(), user_id: req.user.sub, stage_id: stageId, content, version, updated_at: now() });
        return { version, content, merged };
      };
      if (!current || current.version === body.baseVersion) return save(body.content, false);
      const outcome = threeWayMerge(body.baseContent, body.content, current.content);
      if (outcome.clean) return save(outcome.text, true);
      reply.code(409);
      return { conflict: true, serverVersion: current.version, serverContent: current.content, conflicts: outcome.conflicts, preview: outcome.preview };
    });
  });

  app.post("/api/stages/:stageId/submissions", { preHandler: requireAuth("LEARNER"), bodyLimit: 16 * 1024 * 1024 }, async (req, reply) =>
    idempotent(req, reply, () => {
      const { stageId } = req.params as { stageId: string };
      const body = parse(SubmissionInput, req.body);
      const st = stageForLearner(req.user.sub, stageId);
      const d = db();
      const latest = d.get<{ status: string; version: number }>("SELECT status, version FROM submissions WHERE user_id = ? AND stage_id = ? ORDER BY version DESC LIMIT 1", req.user.sub, stageId);
      if (latest?.status === "SUBMITTED") throw new HttpError(409, "Your last version is still with a mentor. You can resubmit once it has been reviewed.");
      if (latest?.status === "APPROVED") throw new HttpError(409, "This stage is already approved.");

      let filePath: string | null = null;
      if (body.file) {
        const ext = extname(body.file.name).toLowerCase();
        if (!ALLOWED_TYPES.has(ext)) throw new HttpError(400, `File type ${ext || "(none)"} is not allowed`);
        const bytes = Buffer.from(body.file.dataBase64, "base64");
        if (bytes.length > config.maxUploadBytes) throw new HttpError(413, "Files are limited to 10 MB");
        mkdirSync(config.uploadDir, { recursive: true });
        filePath = join(config.uploadDir, `${id()}-${basename(body.file.name).replace(/[^\w.-]+/g, "_")}`);
        writeFileSync(filePath, bytes);
      }

      const submissionId = id();
      const version = (latest?.version ?? 0) + 1;
      const assignment = d.tx(() => {
        d.insert("submissions", { id: submissionId, enrolment_id: st.enrolment_id, stage_id: stageId, user_id: req.user.sub, content: body.content, file_path: filePath, version, status: "SUBMITTED", submitted_at: now() });
        d.run("DELETE FROM drafts WHERE user_id = ? AND stage_id = ?", req.user.sub, stageId);
        audit(req.user.sub, "submission.created", "submission", submissionId, { stageId, version, hasFile: !!filePath });
        return assignSubmission(submissionId);
      });
      reply.code(201);
      return { ...submissionDto(d.get<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", submissionId)!), assignedMentor: !!assignment };
    }),
  );

  app.get("/api/stages/:stageId/submissions", { preHandler: requireAuth() }, async (req) => {
    const { stageId } = req.params as { stageId: string };
    const q = parse(z.object({ userId: z.string().optional() }), req.query);
    const userId = req.user.role === "LEARNER" ? req.user.sub : q.userId;
    if (!userId) throw new HttpError(400, "userId is required");
    if (!canView(req.user, { user_id: userId, stage_id: stageId })) throw forbidden();
    return db().all<SubmissionRow>("SELECT * FROM submissions WHERE user_id = ? AND stage_id = ? ORDER BY version DESC", userId, stageId).map(submissionDto);
  });

  app.get("/api/submissions/:id", { preHandler: requireAuth() }, async (req) => {
    const s = db().get<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", (req.params as { id: string }).id);
    if (!s) throw notFound("Submission not found");
    if (!canView(req.user, s)) throw forbidden();
    return submissionDto(s);
  });

  /** Word-level diff against the previous version, so a mentor sees exactly what changed. */
  app.get("/api/submissions/:id/diff", { preHandler: requireAuth() }, async (req) => {
    const d = db();
    const s = d.get<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", (req.params as { id: string }).id);
    if (!s) throw notFound("Submission not found");
    if (!canView(req.user, s)) throw forbidden();
    const prev = d.get<SubmissionRow>("SELECT * FROM submissions WHERE user_id = ? AND stage_id = ? AND version = ?", s.user_id, s.stage_id, s.version - 1);
    if (!prev) return { previousVersion: null, parts: [{ value: s.content, added: false, removed: false }] };
    const parts = diffWords(prev.content, s.content).map((p) => ({ value: p.value, added: !!p.added, removed: !!p.removed }));
    const prevFeedback = d.get<{ improvements: string }>("SELECT improvements FROM feedback WHERE submission_id = ?", prev.id);
    return { previousVersion: prev.version, previousImprovements: prevFeedback?.improvements ?? null, parts };
  });

  // Files are served only through short-lived signed links handed out to authorised viewers.
  app.get("/api/files/:id", async (req, reply) => {
    const { id: sid } = req.params as { id: string };
    const q = req.query as { exp?: string; sig?: string };
    if (!checkFileSignature(sid, Number(q.exp), q.sig ?? "")) throw new HttpError(403, "This file link has expired. Reopen the submission to get a new one.");
    const s = db().get<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", sid);
    const uploadRoot = resolve(config.uploadDir);
    if (!s?.file_path || !resolve(s.file_path).startsWith(uploadRoot) || !existsSync(s.file_path)) throw notFound("File not found");
    const name = basename(s.file_path).replace(/^[0-9a-f-]{36}-/, "");
    reply.header("Content-Disposition", `attachment; filename="${name}"`).header("X-Content-Type-Options", "nosniff");
    return reply.type("application/octet-stream").send(createReadStream(s.file_path));
  });
}
