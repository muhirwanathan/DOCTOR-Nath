import { db, now } from "../db.js";
import { canonicalJson, entryHash, GENESIS, verifyChain, type ChainEntry } from "../lib/hashchain.js";

/** Appends a hash-chained audit entry. Call inside the same transaction as the change it records. */
export function audit(actorId: string | null, action: string, entity: string, entityId: string | null, data: unknown = {}) {
  const d = db();
  const last = d.get<{ hash: string }>("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const entry = { ts: now(), actor_id: actorId, action, entity, entity_id: entityId, data: canonicalJson(data), prev_hash: last?.hash ?? GENESIS };
  d.insert("audit_log", { ...entry, hash: entryHash(entry) });
}

export function verifyAuditLog() {
  return verifyChain(db().all<ChainEntry>("SELECT * FROM audit_log ORDER BY seq"));
}
