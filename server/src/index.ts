import { existsSync } from "node:fs";
import { config } from "./config.js";

// Hosted demo: free hosting wipes the disk on restart, so load the demo data when no database exists yet.
if (config.seedIfEmpty && config.dbPath !== ":memory:" && !existsSync(config.dbPath)) {
  await import("./seed.js");
}

const { buildApp } = await import("./app.js");
import { checkSlas } from "./services/assign.js";
import { issuerKeys } from "./services/issuer.js";
import { processOutbox } from "./services/notify.js";

const app = await buildApp();
issuerKeys(); // create the badge-signing key on first run

// Background workers: notification outbox and feedback SLA monitor.
let outboxBusy = false;
setInterval(async () => {
  if (outboxBusy) return;
  outboxBusy = true;
  try {
    await processOutbox();
  } catch (err) {
    app.log.error(err, "outbox worker failed");
  } finally {
    outboxBusy = false;
  }
}, config.notifyPollMs);

setInterval(() => {
  try {
    const r = checkSlas();
    if (r.warned || r.reassigned) app.log.info(r, "SLA check");
  } catch (err) {
    app.log.error(err, "SLA monitor failed");
  }
}, config.slaCheckMs);

await app.listen({ port: config.port, host: "0.0.0.0" });
