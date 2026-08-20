import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoDepGraph } from '../src/adapters/depgraph/go.js';
import { UnionDepGraph } from '../src/adapters/depgraph/union.js';
import type { DepGraph, FileEdge } from '../src/adapters/depgraph/index.js';

/**
 * Go import-graph builder (Phase 3, docs/go-language-support-plan.md;
 * multi-module discovery, docs/go-multi-module-depgraph-plan.md) —
 * hermetic, no DB/Docker. Fixture is real files on disk (mkdtemp +
 * writeFile), matching this repo's existing convention (see
 * indexer-pipeline.test.ts) rather than a committed fixtures/ directory.
 *
 * `node:fs/promises` is mocked as a passthrough wrapper (every export is the
 * real implementation via `vi.importActual`, except `readFile` which is
 * additionally wrapped in `vi.fn` so call counts/paths can be asserted) —
 * this lets the memoization (WI-8/AC-4) and traversal-safety (WI-5/AC-9,
 * AC-10) tests below observe real fs calls without adding any new export
 * from go.ts just for testability.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  };
});
describe('GoDepGraph', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-'));
    await mkdir(join(root, 'internal', 'util'), { recursive: true });
    await writeFile(root + '/go.mod', 'module example.com/greeter\n\ngo 1.22\n');
    await writeFile(
      join(root, 'main.go'),
      `package main

import (
	"fmt"
	"example.com/greeter/internal/util"
)

func main() {
	fmt.Println(util.Shout("hi"))
}
`,
    );
    await writeFile(
      join(root, 'internal', 'util', 'util.go'),
      `package util

func Shout(s string) string {
	return s + "!"
}
`,
    );
    await writeFile(
      join(root, 'internal', 'util', 'extra.go'),
      `package util

func Whisper(s string) string {
	return s
}
`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  const files = ['main.go', 'internal/util/util.go', 'internal/util/extra.go'];

  it('edges a local import to every file in the target package directory', async () => {
    const edges = await new GoDepGraph().buildEdges(root, files);
    expect(edges).toContainEqual({ from: 'main.go', to: 'internal/util/util.go' });
    expect(edges).toContainEqual({ from: 'main.go', to: 'internal/util/extra.go' });
  });

  it('does not edge the stdlib import ("fmt")', async () => {
    const edges = await new GoDepGraph().buildEdges(root, files);
    expect(edges.some((e) => e.to === 'fmt' || e.from === 'fmt')).toBe(false);
  });

  it('does not edge a package to itself', async () => {
    const edges = await new GoDepGraph().buildEdges(root, files);
    expect(edges.some((e) => e.from === e.to)).toBe(false);
  });

  it('returns [] when there are no Go files in the given set', async () => {
    const edges = await new GoDepGraph().buildEdges(root, ['README.md']);
    expect(edges).toEqual([]);
  });

  it('returns [] when go.mod is missing', async () => {
    const noModRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-nomod-'));
    try {
      await writeFile(join(noModRoot, 'main.go'), 'package main\n\nfunc main() {}\n');
      const edges = await new GoDepGraph().buildEdges(noModRoot, ['main.go']);
      expect(edges).toEqual([]);
    } finally {
      await rm(noModRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

// WI-6 (AC-2): multi-module monorepo — three sibling go.mod files, none at
// root, each resolving local imports entirely independently.
describe('GoDepGraph — multi-module monorepo (WI-6, AC-2)', () => {
  let monoRoot: string;

  beforeAll(async () => {
    monoRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-multi-'));

    await mkdir(join(monoRoot, 'gameserver', 'internal', 'state'), { recursive: true });
    await writeFile(join(monoRoot, 'gameserver', 'go.mod'), 'module example.com/gameserver\n\ngo 1.22\n');
    await writeFile(
      join(monoRoot, 'gameserver', 'main.go'),
      `package main

import "example.com/gameserver/internal/state"

func main() {
	state.New()
}
`,
    );
    await writeFile(
      join(monoRoot, 'gameserver', 'internal', 'state', 'state.go'),
      'package state\n\nfunc New() {}\n',
    );

    await mkdir(join(monoRoot, 'platform', 'internal', 'net'), { recursive: true });
    await writeFile(join(monoRoot, 'platform', 'go.mod'), 'module example.com/platform\n\ngo 1.22\n');
    await writeFile(
      join(monoRoot, 'platform', 'server.go'),
      `package platform

import "example.com/platform/internal/net"

func Serve() {
	net.Listen()
}
`,
    );
    await writeFile(join(monoRoot, 'platform', 'internal', 'net', 'net.go'), 'package net\n\nfunc Listen() {}\n');

    await mkdir(join(monoRoot, 'shared'), { recursive: true });
    await writeFile(join(monoRoot, 'shared', 'go.mod'), 'module example.com/shared\n\ngo 1.22\n');
    await writeFile(join(monoRoot, 'shared', 'util.go'), 'package shared\n\nfunc Util() {}\n');
  });

  afterAll(async () => {
    await rm(monoRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  const monoFiles = [
    'gameserver/main.go',
    'gameserver/internal/state/state.go',
    'platform/server.go',
    'platform/internal/net/net.go',
    'shared/util.go',
  ];

  it('resolves each sibling module independently and produces zero cross-module edges', async () => {
    const edges = await new GoDepGraph().buildEdges(monoRoot, monoFiles);

    expect(edges).toContainEqual({ from: 'gameserver/main.go', to: 'gameserver/internal/state/state.go' });
    expect(edges).toContainEqual({ from: 'platform/server.go', to: 'platform/internal/net/net.go' });

    for (const edge of edges) {
      const fromTop = edge.from.split('/')[0];
      const toTop = edge.to.split('/')[0];
      expect(toTop).toBe(fromTop);
    }
  });
});

// WI-7 (AC-1, AC-5): subdirectory-only single module — no go.mod at root,
// direct regression test for the repo-relative-key join bug.
describe('GoDepGraph — subdirectory-only single module (WI-7, AC-1, AC-5)', () => {
  let subRoot: string;

  beforeAll(async () => {
    subRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-subdir-'));
    await mkdir(join(subRoot, 'gameserver', 'internal', 'foo'), { recursive: true });
    await writeFile(join(subRoot, 'gameserver', 'go.mod'), 'module example.com/gameserver\n\ngo 1.22\n');
    await writeFile(
      join(subRoot, 'gameserver', 'main.go'),
      `package main

import "example.com/gameserver/internal/foo"

func main() {
	foo.Do()
}
`,
    );
    await writeFile(join(subRoot, 'gameserver', 'internal', 'foo', 'foo.go'), 'package foo\n\nfunc Do() {}\n');
  });

  afterAll(async () => {
    await rm(subRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('resolves local imports to repo-relative keys, not module-relative-only keys', async () => {
    const files = ['gameserver/main.go', 'gameserver/internal/foo/foo.go'];
    const edges = await new GoDepGraph().buildEdges(subRoot, files);
    expect(edges).toContainEqual({ from: 'gameserver/main.go', to: 'gameserver/internal/foo/foo.go' });
  });
});

// WI-4 (AC-3): nested-module boundary — deepest go.mod wins for a
// directory's own governing module, and the target-side guard closes the
// cross-module-edge leak an outer-module import can otherwise produce when
// its import string prefix-matches into an inner module's directory.
describe('GoDepGraph — nested-module boundary guard (WI-4, AC-3)', () => {
  let nestedRoot: string;

  beforeAll(async () => {
    nestedRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-nested-'));

    // Outer module: example.com/outer, rooted at a/.
    await mkdir(join(nestedRoot, 'a', 'sub'), { recursive: true });
    await writeFile(join(nestedRoot, 'a', 'go.mod'), 'module example.com/outer\n\ngo 1.22\n');
    await writeFile(
      join(nestedRoot, 'a', 'main.go'),
      `package main

import (
	"example.com/outer/b/x"
	"example.com/outer/sub"
)

func main() {
	x.Do()
	sub.Do()
}
`,
    );
    await writeFile(join(nestedRoot, 'a', 'sub', 'helper.go'), 'package sub\n\nfunc Do() {}\n');

    // Inner module: example.com/outer/b, rooted at a/b/ — a *different*,
    // more-nested go.mod than a/go.mod.
    await mkdir(join(nestedRoot, 'a', 'b', 'x'), { recursive: true });
    await writeFile(join(nestedRoot, 'a', 'b', 'go.mod'), 'module example.com/outer/b\n\ngo 1.22\n');
    await writeFile(
      join(nestedRoot, 'a', 'b', 'main.go'),
      `package b

import "example.com/outer/b/x"

func Init() {
	x.Do()
}
`,
    );
    await writeFile(join(nestedRoot, 'a', 'b', 'x', 'x.go'), 'package x\n\nfunc Do() {}\n');
  });

  afterAll(async () => {
    await rm(nestedRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  const nestedFiles = ['a/main.go', 'a/sub/helper.go', 'a/b/main.go', 'a/b/x/x.go'];

  it('produces zero edges from an outer-module file into an inner module it only string-prefix-matches into', async () => {
    const edges = await new GoDepGraph().buildEdges(nestedRoot, nestedFiles);
    expect(edges.some((e) => e.from === 'a/main.go' && e.to.startsWith('a/b/'))).toBe(false);
  });

  it('still produces edges for a genuine same-module case (a/ importing a/sub/, which has no go.mod of its own)', async () => {
    const edges = await new GoDepGraph().buildEdges(nestedRoot, nestedFiles);
    expect(edges).toContainEqual({ from: 'a/main.go', to: 'a/sub/helper.go' });
  });

  it("resolves the inner module's own local imports against its own go.mod, not the outer module's", async () => {
    const edges = await new GoDepGraph().buildEdges(nestedRoot, nestedFiles);
    expect(edges).toContainEqual({ from: 'a/b/main.go', to: 'a/b/x/x.go' });
  });
});

// WI-8 (AC-4): discovery memoization — a shared directory's go.mod is read
// at most once across the whole buildEdges call, despite multiple files
// sharing that directory.
describe('GoDepGraph — go.mod discovery memoization (WI-8, AC-4)', () => {
  let memoRoot: string;

  beforeAll(async () => {
    memoRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-memo-'));
    await writeFile(join(memoRoot, 'go.mod'), 'module example.com/memotest\n\ngo 1.22\n');
    await writeFile(join(memoRoot, 'a.go'), 'package memotest\n');
    await writeFile(join(memoRoot, 'b.go'), 'package memotest\n');
    await writeFile(join(memoRoot, 'c.go'), 'package memotest\n');
  });

  afterAll(async () => {
    await rm(memoRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('reads a shared directory\'s go.mod at most once despite 3 files sharing that directory', async () => {
    const mockedReadFile = vi.mocked(readFile);
    mockedReadFile.mockClear();

    const edges = await new GoDepGraph().buildEdges(memoRoot, ['a.go', 'b.go', 'c.go']);
    expect(edges).toEqual([]);

    const goModPath = join(memoRoot, 'go.mod');
    const goModCalls = mockedReadFile.mock.calls.filter(([path]) => String(path) === goModPath);
    expect(goModCalls.length).toBe(1);
  });
});

// WI-9 (AC-11): deep-nesting termination bound — a directory 5+ segments
// deep with no go.mod anywhere in its ancestry terminates and returns []
// without hanging, checking at most one go.mod candidate per directory
// level, never above root.
describe('GoDepGraph — deep-nesting termination bound (WI-9, AC-11)', () => {
  let deepRoot: string;
  const deepRel = 'x1/x2/x3/x4/x5';

  beforeAll(async () => {
    deepRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-deep-'));
    await mkdir(join(deepRoot, deepRel), { recursive: true });
    await writeFile(join(deepRoot, deepRel, 'deep.go'), 'package deep\n');
  });

  afterAll(async () => {
    await rm(deepRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('terminates and returns [] for a 5+-segment-deep directory with no go.mod anywhere, one readFile per level', async () => {
    const mockedReadFile = vi.mocked(readFile);
    mockedReadFile.mockClear();

    const edges = await new GoDepGraph().buildEdges(deepRoot, [`${deepRel}/deep.go`]);
    expect(edges).toEqual([]);

    const goModCalls = mockedReadFile.mock.calls.filter(([path]) => String(path).endsWith('go.mod'));
    // 5 nested levels + root itself = 6 directory levels, each checked exactly once.
    expect(goModCalls.length).toBe(6);
    for (const [path] of goModCalls) {
      expect(String(path).startsWith(deepRoot)).toBe(true);
    }
  });
});

// WI-5 (AC-9, AC-10): fail-closed traversal safety — a resolved import
// shaped for path traversal only ever feeds a filesByDir map lookup, never
// a real filesystem read, so it fails closed instead of escaping root.
describe('GoDepGraph — adversarial traversal-shaped import (WI-5, AC-9, AC-10)', () => {
  let advRoot: string;

  beforeAll(async () => {
    advRoot = await mkdtemp(join(tmpdir(), 'devdigest-go-depgraph-adversarial-'));
    await writeFile(join(advRoot, 'go.mod'), 'module example.com/gameserver\n\ngo 1.22\n');
    await writeFile(
      join(advRoot, 'main.go'),
      `package main

import "example.com/gameserver/../../../etc"

func main() {}
`,
    );
  });

  afterAll(async () => {
    await rm(advRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('fails closed on a traversal-shaped import: zero edges, no fs call outside root', async () => {
    const mockedReadFile = vi.mocked(readFile);
    mockedReadFile.mockClear();

    const edges = await new GoDepGraph().buildEdges(advRoot, ['main.go']);
    expect(edges).toEqual([]);

    const outsideRootCalls = mockedReadFile.mock.calls.filter(([path]) => !String(path).startsWith(advRoot));
    expect(outsideRootCalls).toEqual([]);
  });
});

describe('UnionDepGraph', () => {
  it('concatenates edges from every composed builder', async () => {
    const a: DepGraph = { buildEdges: async () => [{ from: 'a.ts', to: 'b.ts' }] };
    const b: DepGraph = { buildEdges: async () => [{ from: 'x.go', to: 'y.go' }] };
    const union = new UnionDepGraph([a, b]);
    const edges = await union.buildEdges('/repo', ['a.ts', 'b.ts', 'x.go', 'y.go']);
    expect(edges).toEqual<FileEdge[]>([
      { from: 'a.ts', to: 'b.ts' },
      { from: 'x.go', to: 'y.go' },
    ]);
  });

  it('defaults to DepCruiseGraph + GoDepGraph when constructed with no args', async () => {
    const union = new UnionDepGraph();
    const edges = await union.buildEdges('/nonexistent-root', ['a.ts', 'a.go']);
    expect(edges).toEqual([]);
  });
});
