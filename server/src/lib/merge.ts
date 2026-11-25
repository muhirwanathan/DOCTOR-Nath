import { diff3Merge } from "node-diff3";

// Offline drafts can be edited on two devices (e.g. a phone on 3G and a shared
// computer). When a device syncs an edit made against an older version, we
// three-way merge it: base = the version the device last saw, local = the
// device's text, remote = what the server holds now. Edits to different lines
// combine automatically; overlapping edits come back as conflicts for the learner.

export interface MergeConflict {
  base: string;
  local: string;
  remote: string;
}

export type MergeOutcome = { clean: true; text: string } | { clean: false; conflicts: MergeConflict[]; preview: string };

const lines = (s: string) => s.split(/\r?\n/);

export function threeWayMerge(base: string, local: string, remote: string): MergeOutcome {
  if (local === remote) return { clean: true, text: local };
  if (local === base) return { clean: true, text: remote };
  if (remote === base) return { clean: true, text: local };

  const regions = diff3Merge(lines(local), lines(base), lines(remote), { excludeFalseConflicts: true });
  const out: string[] = [];
  const conflicts: MergeConflict[] = [];
  for (const r of regions) {
    if (r.ok) {
      out.push(...r.ok);
    } else if (r.conflict) {
      const c = { base: r.conflict.o.join("\n"), local: r.conflict.a.join("\n"), remote: r.conflict.b.join("\n") };
      conflicts.push(c);
      out.push("<<<<<<< this device", c.local, "=======", c.remote, ">>>>>>> other device");
    }
  }
  return conflicts.length ? { clean: false, conflicts, preview: out.join("\n") } : { clean: true, text: out.join("\n") };
}
