import { describe, it, expect } from 'vitest';
import { splitDiffIntoChunks, isNoiseFile } from '../src/diff-chunker.js';
import type { PRFile } from '../src/types.js';

/** Build a PRFile with sensible defaults. */
function file(filename: string): PRFile {
  return { filename, status: 'modified', additions: 1, deletions: 0, changes: 1 };
}

/** Build a single-file diff section (diff --git header + one hunk with N added lines). */
function section(path: string, addedLines: number): string {
  const adds = Array.from({ length: addedLines }, (_, i) => `+line ${i}`).join('\n');
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,${addedLines + 1} @@\n context\n${adds}`;
}

/** Join file sections into a unified diff the way github.ts produces them. */
function diffOf(...sections: string[]): string {
  return sections.join('\n') + '\n';
}

describe('isNoiseFile', () => {
  it('flags lockfiles by basename anywhere in the tree', () => {
    expect(isNoiseFile('yarn.lock')).toBe(true);
    expect(isNoiseFile('frontend/yarn.lock')).toBe(true);
    expect(isNoiseFile('package-lock.json')).toBe(true);
    expect(isNoiseFile('pnpm-lock.yaml')).toBe(true);
  });

  it('flags generated paths and minified/map files', () => {
    expect(isNoiseFile('packages/x/src/tokens/generated/tokens.ts')).toBe(true);
    expect(isNoiseFile('dist/app.min.js')).toBe(true);
    expect(isNoiseFile('a/b.min.css')).toBe(true);
    expect(isNoiseFile('build/bundle.js.map')).toBe(true);
  });

  it('does not flag ordinary source files', () => {
    expect(isNoiseFile('src/index.ts')).toBe(false);
    expect(isNoiseFile('frontend/src/aja-v2/Routes.tsx')).toBe(false);
    expect(isNoiseFile('lockfile-helper.ts')).toBe(false);
  });
});

describe('splitDiffIntoChunks', () => {
  it('returns a single chunk when the diff is under the target (small-PR passthrough)', () => {
    const files = [file('a.ts'), file('b.ts')];
    const diff = diffOf(section('a.ts', 1), section('b.ts', 1));

    const plan = splitDiffIntoChunks(diff, files, 100_000);

    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].diff).toContain('a/a.ts b/a.ts');
    expect(plan.chunks[0].diff).toContain('a/b.ts b/b.ts');
    expect(plan.skipped).toHaveLength(0);
  });

  it('splits into multiple chunks when the diff exceeds the target', () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`f${i}.ts`));
    const diff = diffOf(...files.map((f) => section(f.filename, 50)));

    const plan = splitDiffIntoChunks(diff, files, 600);

    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it('never splits a single file across chunks and covers every kept file exactly once', () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`f${i}.ts`));
    const diff = diffOf(...files.map((f) => section(f.filename, 50)));

    const plan = splitDiffIntoChunks(diff, files, 600);

    // Each chunk's diff is composed of whole sections (starts at a header).
    for (const chunk of plan.chunks) {
      expect(chunk.diff.startsWith('diff --git ')).toBe(true);
    }
    // Every kept file appears in exactly one chunk, none duplicated or lost.
    const covered = plan.chunks.flatMap((c) => c.files.map((f) => f.filename));
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(files.map((f) => f.filename).sort());
  });

  it('puts a single file larger than the target in its own chunk', () => {
    const files = [file('s1.ts'), file('big.ts'), file('s2.ts')];
    const diff = diffOf(section('s1.ts', 1), section('big.ts', 1000), section('s2.ts', 1));

    const plan = splitDiffIntoChunks(diff, files, 600);

    const bigChunk = plan.chunks.find((c) => c.files.some((f) => f.filename === 'big.ts'));
    expect(bigChunk).toBeDefined();
    expect(bigChunk!.files).toHaveLength(1);
  });

  it('excludes lockfiles from chunks and reports them as skipped', () => {
    const files = [file('yarn.lock'), file('src/a.ts')];
    const diff = diffOf(section('yarn.lock', 20), section('src/a.ts', 2));

    const plan = splitDiffIntoChunks(diff, files, 100_000);

    expect(plan.skipped.map((f) => f.filename)).toContain('yarn.lock');
    const chunkFiles = plan.chunks.flatMap((c) => c.files.map((f) => f.filename));
    expect(chunkFiles).toContain('src/a.ts');
    expect(chunkFiles).not.toContain('yarn.lock');
    // The skipped file's diff text must not leak into any chunk.
    expect(plan.chunks.every((c) => !c.diff.includes('yarn.lock'))).toBe(true);
  });

  it('falls back to a single unsplit chunk when the diff has no parseable headers', () => {
    // Defensive: a non-empty diff we cannot parse must still be reviewed whole,
    // never silently dropped to zero chunks.
    const files = [file('src/a.ts')];
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n+x';

    const plan = splitDiffIntoChunks(diff, files, 100_000);

    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].diff).toBe(diff);
  });

  it('returns no chunks when every section is a noise file (legitimately empty)', () => {
    const files = [file('yarn.lock')];
    const diff = diffOf(section('yarn.lock', 5));

    const plan = splitDiffIntoChunks(diff, files, 100_000);

    expect(plan.chunks).toHaveLength(0);
    expect(plan.skipped.map((f) => f.filename)).toEqual(['yarn.lock']);
  });

  it('excludes generated and minified files from chunks', () => {
    const files = [
      file('packages/x/src/tokens/generated/tokens.ts'),
      file('dist/app.min.js'),
      file('src/keep.ts'),
    ];
    const diff = diffOf(...files.map((f) => section(f.filename, 2)));

    const plan = splitDiffIntoChunks(diff, files, 100_000);

    const skipped = plan.skipped.map((f) => f.filename);
    expect(skipped).toContain('packages/x/src/tokens/generated/tokens.ts');
    expect(skipped).toContain('dist/app.min.js');
    const kept = plan.chunks.flatMap((c) => c.files.map((f) => f.filename));
    expect(kept).toEqual(['src/keep.ts']);
  });
});
