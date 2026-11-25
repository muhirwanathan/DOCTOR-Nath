import { createStore, get, set, del } from "idb-keyval";
import { api, ApiError, NetworkError } from "../api";

// Local-first drafts. Every keystroke is saved to IndexedDB, so nothing is lost
// on a dropped 3G connection (NFR10). Syncing sends the text plus the version and
// text it was based on; the server three-way merges if another device changed it.

export interface LocalDraft {
  content: string;
  baseVersion: number;
  baseContent: string;
  dirty: boolean;
  updatedAt: string;
}

export interface Conflict {
  serverVersion: number;
  serverContent: string;
  preview: string;
  conflicts: { base: string; local: string; remote: string }[];
}

export type SyncResult = { status: "synced"; merged: boolean; draft: LocalDraft } | { status: "offline" } | { status: "conflict"; conflict: Conflict };

const store = createStore("drnath-drafts", "drafts");

export async function loadDraft(stageId: string): Promise<LocalDraft> {
  const local = await get<LocalDraft>(stageId, store);
  if (local?.dirty) return local; // unsynced local edits win until they are pushed
  try {
    const remote = await api<{ content: string; version: number }>("GET", `/api/drafts/${stageId}`);
    const fresh = { content: remote.content, baseVersion: remote.version, baseContent: remote.content, dirty: false, updatedAt: new Date().toISOString() };
    await set(stageId, fresh, store);
    return fresh;
  } catch (err) {
    if (err instanceof NetworkError && local) return local;
    if (err instanceof NetworkError) return { content: "", baseVersion: 0, baseContent: "", dirty: false, updatedAt: new Date().toISOString() };
    throw err;
  }
}

export async function saveLocal(stageId: string, content: string) {
  const current = (await get<LocalDraft>(stageId, store)) ?? { content: "", baseVersion: 0, baseContent: "", dirty: false, updatedAt: "" };
  const next = { ...current, content, dirty: true, updatedAt: new Date().toISOString() };
  await set(stageId, next, store);
  return next;
}

export async function syncDraft(stageId: string): Promise<SyncResult> {
  const local = await get<LocalDraft>(stageId, store);
  if (!local || !local.dirty) return { status: "synced", merged: false, draft: local ?? { content: "", baseVersion: 0, baseContent: "", dirty: false, updatedAt: "" } };
  try {
    const r = await api<{ version: number; content: string; merged: boolean }>("PUT", `/api/drafts/${stageId}`, {
      content: local.content,
      baseVersion: local.baseVersion,
      baseContent: local.baseContent,
    });
    // Keep typing that happened while the request was in flight.
    const latest = (await get<LocalDraft>(stageId, store)) ?? local;
    const stillDirty = latest.content !== local.content;
    const draft = { content: stillDirty ? latest.content : r.content, baseVersion: r.version, baseContent: r.content, dirty: stillDirty, updatedAt: new Date().toISOString() };
    await set(stageId, draft, store);
    return { status: "synced", merged: r.merged, draft };
  } catch (err) {
    if (err instanceof NetworkError) return { status: "offline" };
    if (err instanceof ApiError && err.status === 409 && err.details?.conflicts) {
      return { status: "conflict", conflict: err.details as Conflict };
    }
    throw err;
  }
}

/** The learner picked a resolution: rebase it onto the server's version and push again. */
export async function resolveConflict(stageId: string, resolved: string, conflict: Conflict) {
  await set(stageId, { content: resolved, baseVersion: conflict.serverVersion, baseContent: conflict.serverContent, dirty: true, updatedAt: new Date().toISOString() }, store);
  return syncDraft(stageId);
}

export const clearDraft = (stageId: string) => del(stageId, store);
