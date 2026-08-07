import { diffLines } from "diff";

export interface DiffLine {
  text: string;
  type: "add" | "remove" | "same";
}

/** Line-level diff between two skill-version bodies — client-side only, no
   new server endpoint (each `SkillVersion` row already carries its own
   `body`, per hooks/skills.ts). */
export function computeDiffLines(oldBody: string, newBody: string): DiffLine[] {
  const changes = diffLines(oldBody, newBody);
  const lines: DiffLine[] = [];
  for (const c of changes) {
    const type = c.added ? "add" : c.removed ? "remove" : "same";
    const chunkLines = c.value.split("\n");
    // diffLines' chunk value ends with a trailing "\n" for whole-line
    // chunks — drop the resulting empty trailing entry so we don't render a
    // spurious blank row.
    if (chunkLines[chunkLines.length - 1] === "") chunkLines.pop();
    for (const text of chunkLines) lines.push({ text, type });
  }
  return lines;
}
