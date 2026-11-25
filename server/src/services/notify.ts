import { config } from "../config.js";
import { db, id, now } from "../db.js";

// Transactional outbox: notifications are written in the same transaction as the
// event that causes them, then a worker delivers them with retries. A slow or
// failing email/SMS provider can never block or roll back a learner's request.

export type Channel = "IN_APP" | "EMAIL" | "SMS";

export function notify(userId: string, subject: string, message: string, channels: Channel[] = ["IN_APP", "EMAIL"]) {
  const d = db();
  for (const channel of channels) {
    d.insert("notifications", { id: id(), user_id: userId, channel, subject, message, status: "PENDING", attempts: 0, next_attempt_at: now(), created_at: now() });
  }
}

export function notifyAdmins(subject: string, message: string) {
  for (const a of db().all<{ id: string }>("SELECT id FROM users WHERE role = 'ADMIN'")) notify(a.id, subject, message, ["IN_APP", "EMAIL"]);
}

interface Pending {
  id: string;
  user_id: string;
  channel: Channel;
  subject: string;
  message: string;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

async function deliver(n: Pending, to: { email: string; phone: string | null; name: string }) {
  if (n.channel === "IN_APP") return;
  if (n.channel === "EMAIL") {
    if (!config.sendgridKey) {
      console.info(`[dev-mail] to=${to.email} subject="${n.subject}" ${n.message}`);
      return;
    }
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.sendgridKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to.email, name: to.name }] }],
        from: { email: "no-reply@drnath.rw", name: "Dr. Nath" },
        subject: n.subject,
        content: [{ type: "text/plain", value: n.message }],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid ${res.status}`);
    return;
  }
  if (!to.phone) throw new Error("user has no phone number");
  if (!config.africasTalkingKey) {
    console.info(`[dev-sms] to=${to.phone} ${n.message}`);
    return;
  }
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: { apiKey: config.africasTalkingKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: process.env.AFRICAS_TALKING_USERNAME ?? "sandbox", to: to.phone, message: n.message }),
  });
  if (!res.ok) throw new Error(`Africa's Talking ${res.status}`);
}

/** Delivers due notifications. Failures back off exponentially: 30 s, 1 min, 2 min, 4 min, then FAILED. */
export async function processOutbox(limit = 50) {
  const d = db();
  const due = d.all<Pending>(
    "SELECT id, user_id, channel, subject, message, attempts FROM notifications WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?",
    now(),
    limit,
  );
  for (const n of due) {
    const user = d.get<{ email: string; phone: string | null; name: string }>("SELECT email, phone, name FROM users WHERE id = ?", n.user_id);
    if (!user) continue;
    try {
      await deliver(n, user);
      d.run("UPDATE notifications SET status = 'SENT', sent_at = ?, attempts = attempts + 1 WHERE id = ?", now(), n.id);
    } catch (err) {
      const attempts = n.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const next = new Date(Date.now() + 30_000 * 2 ** (attempts - 1)).toISOString();
      d.run(
        "UPDATE notifications SET attempts = ?, status = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
        attempts,
        failed ? "FAILED" : "PENDING",
        next,
        String(err instanceof Error ? err.message : err),
        n.id,
      );
    }
  }
  return due.length;
}
