import { describe, expect, it } from "vitest";
import { buildCredential, didDocument, generateIssuerKeys, loadIssuerKeys, signCredential, verifyCredential } from "../src/lib/credentials.js";

describe("verifiable credentials", () => {
  const did = "did:web:localhost%3A5173";
  const claim = {
    credentialId: "urn:uuid:1234",
    issuerDid: did,
    issuerName: "Dr. Nath",
    subjectId: "urn:uuid:learner",
    subjectName: "Aline U.",
    badgeName: "Problem Solver",
    criteria: "Mentor-approved stage",
    evidenceUrl: "http://localhost/p/aline",
    issuedAt: "2026-11-20T00:00:00Z",
  };

  it("signs and verifies a badge, surviving a key reload", () => {
    const { keys, privatePem } = generateIssuerKeys(did);
    const jwt = signCredential(buildCredential(claim), keys);
    const reloaded = loadIssuerKeys(privatePem, did);
    const r = verifyCredential(jwt, reloaded.publicKey);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.credential.credentialSubject.achievement.name).toBe("Problem Solver");
    expect(didDocument(did, keys).verificationMethod[0]!.publicKeyJwk.crv).toBe("Ed25519");
  });

  it("rejects tampered or foreign credentials", () => {
    const { keys } = generateIssuerKeys(did);
    const jwt = signCredential(buildCredential(claim), keys);
    const [h, , s] = jwt.split(".");
    const forged = Buffer.from(JSON.stringify({ ...buildCredential(claim), name: "Fake" })).toString("base64url");
    expect(verifyCredential(`${h}.${forged}.${s}`, keys.publicKey)).toMatchObject({ valid: false });
    expect(verifyCredential(jwt, generateIssuerKeys(did).keys.publicKey)).toMatchObject({ valid: false });
    expect(verifyCredential("a.b", keys.publicKey)).toMatchObject({ valid: false });
    expect(verifyCredential("!!.!!.!!", keys.publicKey)).toMatchObject({ valid: false });
  });
});
