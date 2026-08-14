import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/classifier.js';
import { WIRING_ESCALATION_LINE_THRESHOLD } from '../src/modules/smart-diff/constants.js';

/**
 * Unit coverage for the deterministic Smart Diff classifier (Phase 1 of
 * docs/smart-diff-plan.md). No DB — pure function over {path, additions,
 * deletions}.
 */

function file(path: string, additions = 1, deletions = 1) {
  return { path, additions, deletions };
}

describe('classifyFile', () => {
  it('classifies a lockfile as boilerplate', () => {
    expect(classifyFile(file('pnpm-lock.yaml'))).toBe('boilerplate');
  });

  it('classifies package.json as boilerplate', () => {
    expect(classifyFile(file('package.json'))).toBe('boilerplate');
  });

  it('classifies an index.ts barrel with a small diff as wiring', () => {
    expect(classifyFile(file('src/modules/reviews/index.ts', 5, 2))).toBe('wiring');
  });

  it('classifies a *.config.* file with a small diff as wiring', () => {
    expect(classifyFile(file('vite.config.ts', 3, 1))).toBe('wiring');
  });

  it('escalates a wiring-shaped file to core once the diff exceeds the threshold', () => {
    const big = Math.floor(WIRING_ESCALATION_LINE_THRESHOLD / 2) + 1;
    expect(classifyFile(file('src/modules/reviews/index.ts', big, big))).toBe('core');
  });

  it('classifies an ordinary src/**/*.ts business file as core', () => {
    expect(classifyFile(file('src/modules/reviews/service.ts', 40, 10))).toBe('core');
  });

  it('classifies a dist/ path as boilerplate regardless of diff size', () => {
    expect(classifyFile(file('dist/bundle.js', 500, 500))).toBe('boilerplate');
  });

  it('classifies a .snap path as boilerplate regardless of diff size', () => {
    expect(classifyFile(file('src/__snapshots__/App.test.tsx.snap', 500, 500))).toBe(
      'boilerplate',
    );
  });

  it('classifies Go main.go as wiring', () => {
    expect(classifyFile(file('cmd/server/main.go', 5, 2))).toBe('wiring');
  });

  it('classifies a /vendor/-path Go file as boilerplate', () => {
    expect(classifyFile(file('vendor/github.com/pkg/errors/errors.go', 500, 500))).toBe(
      'boilerplate',
    );
  });

  it('classifies Python __init__.py as wiring', () => {
    expect(classifyFile(file('app/__init__.py', 5, 2))).toBe('wiring');
  });

  it('classifies a /__pycache__/-path Python file as boilerplate', () => {
    expect(classifyFile(file('app/__pycache__/module.cpython-312.pyc', 500, 500))).toBe(
      'boilerplate',
    );
  });

  it('classifies Rust mod.rs as wiring', () => {
    expect(classifyFile(file('src/mod.rs', 5, 2))).toBe('wiring');
  });

  it('classifies a /target/-path Rust file as boilerplate', () => {
    expect(classifyFile(file('target/debug/build/output.rs', 500, 500))).toBe('boilerplate');
  });
});
