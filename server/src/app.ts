import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import challengeRoutes from "./routes/challenges.js";
import learnerRoutes from "./routes/learner.js";
import mentorRoutes from "./routes/mentor.js";
import workRoutes from "./routes/work.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "../../web/dist");

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger: logger ? { level: "info" } : false, bodyLimit: 1024 * 1024 });

  await app.register(cors, { origin: [config.publicUrl, "http://localhost:5173"], credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "same-origin").header("X-Frame-Options", "DENY");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "Something went wrong on our side. Please try again." });
  });

  await app.register(authRoutes);
  await app.register(challengeRoutes);
  await app.register(workRoutes);
  await app.register(mentorRoutes);
  await app.register(learnerRoutes);
  await app.register(adminRoutes);
  app.get("/api/health", async () => ({ ok: true }));

  // In production the API also serves the built PWA, with client-side routing fallback.
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.method !== "GET") return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
