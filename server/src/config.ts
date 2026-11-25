import { existsSync } from "node:fs";

// Optional .env file (see .env.example). Variables already set in the environment win.
if (existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  dbPath: env.DB_PATH ?? "data/dr-nath.db",
  uploadDir: env.UPLOAD_DIR ?? "data/uploads",
  keyPath: env.ISSUER_KEY_PATH ?? "data/issuer-key.json",
  // Public origin used inside credentials and portfolio links.
  // Render sets RENDER_EXTERNAL_URL automatically for deployed services.
  publicUrl: env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL ?? "http://localhost:5173",
  seedIfEmpty: env.SEED_IF_EMPTY === "true",
  // A fixed dev secret keeps logins valid across `tsx watch` restarts.
  jwtSecret: env.JWT_SECRET ?? (env.NODE_ENV === "production" ? "" : "dev-only-insecure-secret"),
  maxUploadBytes: 10 * 1024 * 1024, // FR4.1
  feedbackSlaDays: Number(env.FEEDBACK_SLA_DAYS ?? 5), // success measure: feedback within 5 days
  slaWarnFraction: 0.6, // warn the mentor at 60% of the SLA window
  slaCheckMs: Number(env.SLA_CHECK_MS ?? 60_000),
  notifyPollMs: Number(env.NOTIFY_POLL_MS ?? 5_000),
  sendgridKey: env.SENDGRID_API_KEY,
  africasTalkingKey: env.AFRICAS_TALKING_API_KEY,
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");
