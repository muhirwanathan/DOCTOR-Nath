import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { generateIssuerKeys, loadIssuerKeys, type IssuerKeys } from "../lib/credentials.js";

// did:web identifier for the platform, e.g. did:web:localhost%3A5173
export const issuerDid = () => {
  const u = new URL(config.publicUrl);
  return `did:web:${encodeURIComponent(u.host)}`;
};

let cached: IssuerKeys | undefined;

/** Loads the Ed25519 issuer key, creating it on first run. Keep this file secret and backed up. */
export function issuerKeys(): IssuerKeys {
  if (cached) return cached;
  if (existsSync(config.keyPath)) {
    const { privatePem } = JSON.parse(readFileSync(config.keyPath, "utf8")) as { privatePem: string };
    cached = loadIssuerKeys(privatePem, issuerDid());
  } else {
    const { keys, privatePem } = generateIssuerKeys(issuerDid());
    mkdirSync(dirname(config.keyPath), { recursive: true });
    writeFileSync(config.keyPath, JSON.stringify({ privatePem }), { mode: 0o600 });
    cached = keys;
  }
  return cached;
}
