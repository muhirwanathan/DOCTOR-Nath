import { describe, expect, it } from "vitest";
import { canonicalJson, entryHash, GENESIS, verifyChain, type ChainEntry } from "../src/lib/hashchain.js";

describe("hash chain", () => {
  const build = (n: number): ChainEntry[] => {
    const out: ChainEntry[] = [];
    let prev = GENESIS;
    for (let i = 1; i <= n; i++) {
      const e = { ts: `2026-11-0${i}T00:00:00Z`, actor_id: "u1", action: "test", entity: "x", entity_id: String(i), data: canonicalJson({ i }), prev_hash: prev };
      const hash = entryHash(e);
      out.push({ ...e, seq: i, hash });
      prev = hash;
    }
    return out;
  };

  it("sorts keys so equal objects hash equally", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 2, y: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":1,"z":2}]},"b":1}');
  });

  it("accepts an untouched chain", () => {
    expect(verifyChain(build(4))).toMatchObject({ valid: true, entries: 4 });
  });

  it("detects an edited row", () => {
    const chain = build(4);
    chain[1]!.data = canonicalJson({ i: 99 });
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 2 });
  });

  it("detects a deleted row", () => {
    const chain = build(4);
    chain.splice(1, 1);
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 3 });
  });
});
