import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password hashing", () => {
  it("verifies the right password and rejects others", () => {
    const h = hashPassword("kigali-2026");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("kigali-2026", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });

  it("salts every hash", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});
