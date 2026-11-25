import { createHash } from "node:crypto";

// Tamper-evident log: every entry's hash covers its content and the previous
// entry's hash, so editing or deleting any row breaks every hash after it.

export const GENESIS = "0".repeat(64);

export interface ChainEntry {
  seq: number;
  ts: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  data: string; // canonical JSON
  prev_hash: string;
  hash: string;
}

/** JSON with object keys sorted at every level, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function entryHash(e: Omit<ChainEntry, "hash" | "seq">): string {
  const body = [e.prev_hash, e.ts, e.actor_id ?? "", e.action, e.entity, e.entity_id ?? "", e.data].join("|");
  return createHash("sha256").update(body).digest("hex");
}

export type ChainCheck =
  | { valid: true; entries: number; head: string }
  | { valid: false; entries: number; brokenAt: number; reason: string };

export function verifyChain(entries: ChainEntry[]): ChainCheck {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev_hash !== prev) {
      return { valid: false, entries: entries.length, brokenAt: e.seq, reason: "prev_hash does not match the previous entry (row deleted or reordered)" };
    }
    if (entryHash(e) !== e.hash) {
      return { valid: false, entries: entries.length, brokenAt: e.seq, reason: "hash does not match content (row edited)" };
    }
    prev = e.hash;
  }
  return { valid: true, entries: entries.length, head: prev };
}
