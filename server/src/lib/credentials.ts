import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

// Badges as W3C Verifiable Credentials (VC Data Model 2.0) with an Open Badges 3.0
// achievement, secured as a compact JWS signed with Ed25519 (alg "EdDSA").
// Anyone can verify a badge offline with the issuer's public key, which is
// published at /.well-known/did.json (did:web), so employers need not trust our database.

export interface IssuerKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicJwk: JsonWebKey;
  kid: string;
}

export function generateIssuerKeys(issuerDid: string): { keys: IssuerKeys; privatePem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { keys: toIssuerKeys(privateKey, publicKey, issuerDid), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

export function loadIssuerKeys(privatePem: string, issuerDid: string): IssuerKeys {
  const privateKey = createPrivateKey(privatePem);
  return toIssuerKeys(privateKey, createPublicKey(privateKey), issuerDid);
}

function toIssuerKeys(privateKey: KeyObject, publicKey: KeyObject, issuerDid: string): IssuerKeys {
  return { privateKey, publicKey, publicJwk: publicKey.export({ format: "jwk" }), kid: `${issuerDid}#key-1` };
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export interface BadgeClaim {
  credentialId: string;
  issuerDid: string;
  issuerName: string;
  subjectId: string; // learner identifier (portfolio URL or urn)
  subjectName: string;
  badgeName: string;
  criteria: string;
  evidenceUrl?: string;
  issuedAt: string;
}

export function buildCredential(c: BadgeClaim) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
    id: c.credentialId,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: { id: c.issuerDid, type: ["Profile"], name: c.issuerName },
    validFrom: c.issuedAt,
    name: c.badgeName,
    credentialSubject: {
      id: c.subjectId,
      type: ["AchievementSubject"],
      name: c.subjectName,
      achievement: {
        id: `${c.credentialId}#achievement`,
        type: ["Achievement"],
        name: c.badgeName,
        criteria: { narrative: c.criteria },
      },
    },
    ...(c.evidenceUrl ? { evidence: [{ id: c.evidenceUrl, type: ["Evidence"] }] } : {}),
  };
}

export function signCredential(vc: ReturnType<typeof buildCredential>, keys: IssuerKeys): string {
  const header = { alg: "EdDSA", typ: "vc+jwt", kid: keys.kid };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(vc))}`;
  const signature = sign(null, Buffer.from(signingInput), keys.privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

export type VerifyResult =
  | { valid: true; credential: ReturnType<typeof buildCredential>; header: Record<string, unknown> }
  | { valid: false; reason: string };

export function verifyCredential(jwt: string, publicKey: KeyObject): VerifyResult {
  const parts = jwt.split(".");
  if (parts.length !== 3) return { valid: false, reason: "not a compact JWS" };
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: ReturnType<typeof buildCredential>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed header or payload" };
  }
  if (header.alg !== "EdDSA") return { valid: false, reason: `unsupported alg ${String(header.alg)}` };
  const ok = verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
  return ok ? { valid: true, credential: payload, header } : { valid: false, reason: "signature does not match issuer key" };
}

export function didDocument(issuerDid: string, keys: IssuerKeys) {
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
    id: issuerDid,
    verificationMethod: [{ id: keys.kid, type: "JsonWebKey", controller: issuerDid, publicKeyJwk: keys.publicJwk }],
    assertionMethod: [keys.kid],
  };
}
