import { describe, expect, it } from "vitest";
import { threeWayMerge } from "../src/lib/merge.js";

describe("three-way merge", () => {
  const base = "line one\nline two\nline three";

  it("takes whichever side changed", () => {
    expect(threeWayMerge(base, base, "remote")).toEqual({ clean: true, text: "remote" });
    expect(threeWayMerge(base, "local", base)).toEqual({ clean: true, text: "local" });
    expect(threeWayMerge(base, "same", "same")).toEqual({ clean: true, text: "same" });
  });

  it("combines edits to different lines", () => {
    const r = threeWayMerge(base, "LINE ONE\nline two\nline three", "line one\nline two\nLINE THREE");
    expect(r).toEqual({ clean: true, text: "LINE ONE\nline two\nLINE THREE" });
  });

  it("reports overlapping edits as conflicts", () => {
    const r = threeWayMerge(base, "line one\nphone edit\nline three", "line one\nlaptop edit\nline three");
    expect(r.clean).toBe(false);
    if (!r.clean) {
      expect(r.conflicts[0]).toMatchObject({ local: "phone edit", remote: "laptop edit" });
      expect(r.preview).toContain("<<<<<<< this device");
    }
  });
});
