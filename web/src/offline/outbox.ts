import { createStore, del, entries, set } from "idb-keyval";
import { api, ApiError, NetworkError } from "../api";

// Offline outbox. Writes made without a connection (submissions, surveys) are
// stored in IndexedDB with a client-generated Idempotency-Key, then replayed in
// order when the connection returns. If the server already processed a request
// whose response was lost, the same key makes it return the original result
// instead of creating a duplicate.

export interface QueuedRequest {
  key: string; // also the Idempotency-Key
  method: string;
  url: string;
  body: unknown;
  label: string;
  createdAt: string;
  error?: string;
}

const store = createStore("drnath-outbox", "requests");
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const onOutboxChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export async function queued(): Promise<QueuedRequest[]> {
  const all = (await entries<string, QueuedRequest>(store)).map(([, v]) => v);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueue(req: Omit<QueuedRequest, "key" | "createdAt">) {
  const item: QueuedRequest = { ...req, key: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await set(item.key, item, store);
  emit();
  return item;
}

export async function discard(key: string) {
  await del(key, store);
  emit();
}

/**
 * Sends a write now if possible; if the device is offline, queues it instead.
 * Returns the server response, or { queued: true } when it was stored for later.
 */
export async function sendOrQueue<T extends object = Record<string, unknown>>(method: string, url: string, body: unknown, label: string): Promise<T | { queued: true }> {
  const key = crypto.randomUUID();
  if (navigator.onLine) {
    try {
      return await api<T>(method, url, body, { idempotencyKey: key });
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
  }
  await set(key, { key, method, url, body, label, createdAt: new Date().toISOString() } satisfies QueuedRequest, store);
  emit();
  return { queued: true };
}

let flushing = false;

/** Replays queued writes oldest first. Stops at the first network failure; keeps rejected items with their error. */
export async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const item of await queued()) {
      if (item.error) continue;
      try {
        await api(item.method, item.url, item.body, { idempotencyKey: item.key });
        await del(item.key, store);
      } catch (err) {
        if (err instanceof NetworkError) break;
        if (err instanceof ApiError) await set(item.key, { ...item, error: err.message }, store);
      }
      emit();
    }
  } finally {
    flushing = false;
    emit();
  }
}

export function startOutbox() {
  window.addEventListener("online", () => void flush());
  setInterval(() => void flush(), 30_000);
  void flush();
}
