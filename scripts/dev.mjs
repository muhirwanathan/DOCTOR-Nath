// Starts the API (port 4000) and the web dev server (port 5173) together, on Windows or Unix.
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "--workspace", "server"]],
  ["web", ["run", "dev", "--workspace", "web"]],
].map(([name, args]) => {
  const p = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: true });
  const tag = (chunk) => process.stdout.write(chunk.toString().replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on("data", tag);
  p.stderr.on("data", tag);
  p.on("exit", (code) => {
    console.log(`[${name}] exited (${code})`);
    procs.forEach((q) => q.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on("SIGINT", () => procs.forEach((p) => p.kill()));
