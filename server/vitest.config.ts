import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const scratch = join(tmpdir(), `dr-nath-test-${process.pid}`);

export default defineConfig({
  test: {
    env: {
      DB_PATH: ":memory:",
      UPLOAD_DIR: join(scratch, "uploads"),
      ISSUER_KEY_PATH: join(scratch, "issuer-key.json"),
      PUBLIC_URL: "http://localhost:5173",
      // Tests must never make a real (billed) Claude call: no key, and a profile that does not exist.
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_PROFILE: "dr-nath-test-no-such-profile",
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      thresholds: { lines: 70 },
    },
  },
});
