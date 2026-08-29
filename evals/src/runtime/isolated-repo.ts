/**
 * Disposable sandbox repo for workflow cases that could plausibly lead a model to Write/Edit/Bash.
 *
 * `allowedTools` is NOT a reliable guarantee against this: an incident during eval development
 * showed a workflowTask session call `Edit` (mutating server/INSIGHTS.md with fabricated content)
 * and, separately, call `Bash` to `git add`/`rm`/`git commit` real repo state — neither tool was in
 * WORKFLOW_ALLOWED_TOOLS, and permissionMode: "bypassPermissions" let both execute anyway. Until
 * that SDK behavior is understood/fixed, any case whose prompt could lead to a mutating tool call
 * MUST run against a disposable clone, never REPO_ROOT directly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../artifacts/paths.js";

export interface IsolatedRepo {
  path: string;
  cleanup: () => void;
}

/** Clone the repo's committed (HEAD) content into a fresh tmpdir. Caller must call cleanup(). */
export function cloneRepoToTmpdir(): IsolatedRepo {
  const dir = mkdtempSync(join(tmpdir(), "eval-isolated-"));
  // --local: hardlinks the object store (fast, no network); clones tracked/committed content only
  // (node_modules etc. are gitignored and never copied) — plenty for Read/Grep/Glob and even a
  // stray Write/Edit/Bash, none of which can reach REPO_ROOT from here.
  execFileSync("git", ["clone", "--local", "--quiet", REPO_ROOT, dir], { stdio: "ignore" });
  return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
