#!/usr/bin/env node
// CI runner for `.claude/skills/<name>/evals/evals.json` (skill-creator's eval
// schema). For each eval case it: (1) runs `claude -p` from the repo root with
// only Read/Glob/Skill allowed, so the zod-style project skill can autodiscover
// and trigger on its own — this is a "does the skill still work by default"
// check, not a forced Skill-tool invocation; (2) grades the review output
// against `expectations` with a second `claude -p` call, since expectations
// are natural-language claims ("flags X and recommends Y"), not regexable.
//
// Regression contract: every `expectations[]` entry is a ground-truth fact
// about a fixture (skill-creator/AGENTS.md convention — see
// .claude/skills/zod/evals/evals.json). There is no separate baseline file to
// diff against: an expectation that used to hold and no longer does *is* the
// regression, so any failed expectation (or executor/grader error) exits 1.
//
// Usage: node scripts/run-skill-evals.mjs [--skill <name>] [--eval <name>] [--model <id>]

import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SKILLS_DIR = path.join(REPO_ROOT, ".claude", "skills");
const CLAUDE_TIMEOUT_MS = 180_000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const onlySkill = flag("skill");
const onlyEval = flag("eval");
const model = flag("model") ?? process.env.SKILL_EVAL_MODEL;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `claude -p` calls hit the network and occasionally fail transiently
// (overload, a dropped connection) — that's infra flakiness, not a skill
// regression, so retry a few times before letting it fail the eval.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS) {
        console.log(`\n    (${label} attempt ${attempt} failed, retrying: ${String(err.message ?? err).split("\n")[0]})`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function discoverSuites() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const suites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (onlySkill && entry.name !== onlySkill) continue;
    const evalsPath = path.join(SKILLS_DIR, entry.name, "evals", "evals.json");
    try {
      await readFile(evalsPath, "utf8");
      suites.push({ skill: entry.name, evalsPath });
    } catch {
      // no evals/evals.json for this skill — nothing to run
    }
  }
  return suites;
}

// Runs `claude -p` via spawn (not execFile) so stdin can be explicitly
// closed (`stdio: ["ignore", ...]`) — left as an open, never-written pipe,
// the CLI spends a few seconds probing whether piped input is coming before
// proceeding, which is pure wasted latency for our case (the prompt is
// always passed as a positional arg, never via stdin).
function spawnClaude(cmd) {
  return new Promise((resolve, reject) => {
    // Nesting `claude -p` inside an active Claude Code session (e.g. running
    // this script by hand from a Claude Code shell) is safe, but CLAUDECODE
    // in the env can make the child think it's a bad idea — strip it, same
    // guard skill-creator's own run_eval.py uses for this exact call.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", cmd, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`claude -p timed out after ${CLAUDE_TIMEOUT_MS}ms`));
      } else if (code !== 0) {
        reject(new Error(`claude -p exited with code ${code}${stderr ? `:\n${stderr.slice(0, 1500)}` : ""}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function runClaude(prompt, { allowedTools } = {}) {
  const cmd = ["-p", prompt, "--output-format", "json"];
  if (model) cmd.push("--model", model);
  if (allowedTools) cmd.push("--allowedTools", allowedTools);

  const stdout = await withRetry(() => spawnClaude(cmd), "claude -p");

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude -p did not return valid JSON:\n${stdout.slice(0, 2000)}`);
  }
  if (parsed.is_error) {
    throw new Error(`claude -p returned an error: ${parsed.result ?? stdout.slice(0, 2000)}`);
  }
  return parsed.result;
}

function buildExecutorPrompt(evalCase, skillDir) {
  const files = (evalCase.files ?? []).map((f) => path.relative(REPO_ROOT, path.join(skillDir, f)));
  const fileList = files.length ? `\n\nFile(s) to review:\n${files.map((f) => `- ${f}`).join("\n")}` : "";
  return `${evalCase.prompt}${fileList}`;
}

async function gradeExpectations(reviewOutput, expectations) {
  if (expectations.length === 0) return [];

  const graderPrompt = [
    "You are grading a code-review output against a list of expectations.",
    "For EACH expectation, decide if the review output satisfies it in substance",
    "(same underlying problem, at least roughly the same fix) — exact wording or",
    "a cited rule ID is not required unless the expectation text explicitly names one.",
    "",
    "Review output:",
    '"""',
    reviewOutput,
    '"""',
    "",
    "Expectations:",
    ...expectations.map((e, i) => `${i + 1}. ${e}`),
    "",
    "Respond with ONLY a JSON array, one object per expectation, in the same order:",
    '[{"passed": true|false, "evidence": "short quote or reason"}]',
  ].join("\n");

  const raw = await runClaude(graderPrompt);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`grader did not return a JSON array:\n${raw.slice(0, 2000)}`);
  const graded = JSON.parse(match[0]);
  if (graded.length !== expectations.length) {
    throw new Error(`grader returned ${graded.length} results for ${expectations.length} expectations`);
  }
  return graded;
}

async function runSuite({ skill, evalsPath }) {
  const skillDir = path.dirname(path.dirname(evalsPath)); // .claude/skills/<skill>
  const suite = JSON.parse(await readFile(evalsPath, "utf8"));
  const results = [];

  for (const evalCase of suite.evals) {
    const name = evalCase.name ?? String(evalCase.id);
    if (onlyEval && name !== onlyEval && String(evalCase.id) !== onlyEval) continue;
    process.stdout.write(`  - ${name}... `);
    try {
      const prompt = buildExecutorPrompt(evalCase, skillDir);
      const reviewOutput = await runClaude(prompt, { allowedTools: "Read,Glob,Skill" });
      const expectations = evalCase.expectations ?? [];
      const graded = await gradeExpectations(reviewOutput, expectations);
      const passed = graded.filter((g) => g.passed).length;
      const total = expectations.length;
      results.push({
        id: evalCase.id,
        name,
        total,
        passed,
        expectations: expectations.map((text, i) => ({ text, ...graded[i] })),
      });
      console.log(total === 0 ? "no expectations" : `${passed}/${total}`);
    } catch (err) {
      results.push({ id: evalCase.id, name, error: err.message ?? String(err) });
      console.log("ERROR");
    }
  }
  return { skill, results };
}

function report(suites) {
  let regression = false;
  console.log("\n=== Results ===");
  for (const { skill, results } of suites) {
    console.log(`\n${skill}:`);
    for (const r of results) {
      if (r.error) {
        regression = true;
        console.log(`  ✗ ${r.name}: EXECUTION ERROR — ${r.error}`);
        continue;
      }
      const ok = r.passed === r.total;
      if (!ok) regression = true;
      console.log(`  ${ok ? "✓" : "✗"} ${r.name}: ${r.passed}/${r.total}`);
      for (const e of r.expectations) {
        if (!e.passed) {
          console.log(`      ✗ ${e.text}`);
          console.log(`        ${e.evidence ?? "(grader gave no evidence)"}`);
        }
      }
    }
  }
  return regression;
}

async function writeGithubSummary(suites) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = ["# Skill evals", ""];
  for (const { skill, results } of suites) {
    lines.push(`## ${skill}`, "", "| eval | result | expectations |", "|---|---|---|");
    for (const r of results) {
      if (r.error) {
        lines.push(`| ${r.name} | ⚠️ error | ${r.error} |`);
        continue;
      }
      lines.push(`| ${r.name} | ${r.passed === r.total ? "✅" : "❌"} | ${r.passed}/${r.total} |`);
    }
    lines.push("");
  }
  await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}

async function main() {
  const suiteFiles = await discoverSuites();
  if (suiteFiles.length === 0) {
    console.log(onlySkill ? `No evals/evals.json found for skill "${onlySkill}".` : "No .claude/skills/*/evals/evals.json found — nothing to run.");
    return;
  }

  const suites = [];
  for (const sf of suiteFiles) {
    console.log(`Running evals for "${sf.skill}":`);
    suites.push(await runSuite(sf));
  }

  const regression = report(suites);
  await writeGithubSummary(suites);

  if (regression) {
    console.error("\nRegression: one or more skill evals failed their expectations.");
    process.exitCode = 1;
    return;
  }
  console.log("\nAll skill evals passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
