#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runWorkingMode } from './modes/working.js';
import { EXIT_REVIEW_FAILED } from './output.js';

const HELP = `devdigest review — reuse DevDigest's PR reviewer on your local working copy,
before you push.

Usage:
  devdigest review --mode working

Modes:
  working   Review staged + unstaged changes to TRACKED files (\`git diff HEAD\`).
            Untracked files are never included — this is git's own contract,
            not a limitation this tool adds; run with them staged/committed,
            or wait for --mode staged (not yet available).
  staged    Not yet implemented.
  branch    Not yet implemented.

Requires OPENROUTER_API_KEY in ~/.devdigest/secrets.json or the environment.

Exit codes:
  0   Review completed; no CRITICAL finding (or nothing to review).
  1   Review completed; at least one CRITICAL finding was reported.
  2   The review could not be completed (not a git repo, git failure,
      missing API key, or an LLM/parse error) — never a silent false-clean.
`;

const KNOWN_MODES = new Set(['working', 'staged', 'branch']);

async function main(argv: string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h' || argv.length === 0) {
    console.log(HELP);
    return argv.length === 0 ? EXIT_REVIEW_FAILED : 0;
  }

  const [command, ...rest] = argv;
  if (command !== 'review') {
    console.error(`Unknown command "${command}". Run \`devdigest --help\`.`);
    return EXIT_REVIEW_FAILED;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      mode: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const mode = values.mode;
  if (!mode || !KNOWN_MODES.has(mode)) {
    console.error(`--mode is required and must be one of: ${[...KNOWN_MODES].join(', ')}`);
    return EXIT_REVIEW_FAILED;
  }

  if (mode !== 'working') {
    console.error(`--mode ${mode} is not yet implemented.`);
    return EXIT_REVIEW_FAILED;
  }

  return runWorkingMode(process.cwd());
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`Unexpected error: ${(err as Error).message}`);
    process.exitCode = EXIT_REVIEW_FAILED;
  });
