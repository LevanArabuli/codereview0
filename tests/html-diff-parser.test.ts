import { describe, it, expect } from 'vitest';
import { parseDetailedDiff, type DiffLine, type DiffFile } from '../src/html-diff-parser.js';

describe('parseDetailedDiff', () => {
  it('Case 1: simple modification (one file, one hunk)', () => {
    const raw = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' const d = 5;',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('src/foo.ts');
    expect(result[0].oldFilename).toBe('src/foo.ts');
    expect(result[0].status).toBe('modified');

    const lines = result[0].lines;
    expect(lines).toHaveLength(6);

    // hunk-header
    expect(lines[0]).toEqual({
      type: 'hunk-header',
      oldLineNum: null,
      newLineNum: null,
      content: '@@ -1,3 +1,4 @@',
    });

    // context line: old:1, new:1
    expect(lines[1]).toEqual({
      type: 'context',
      oldLineNum: 1,
      newLineNum: 1,
      content: 'const a = 1;',
    });

    // deletion: old:2, new:null
    expect(lines[2]).toEqual({
      type: 'deletion',
      oldLineNum: 2,
      newLineNum: null,
      content: 'const b = 2;',
    });

    // addition: old:null, new:2
    expect(lines[3]).toEqual({
      type: 'addition',
      oldLineNum: null,
      newLineNum: 2,
      content: 'const b = 3;',
    });

    // addition: old:null, new:3
    expect(lines[4]).toEqual({
      type: 'addition',
      oldLineNum: null,
      newLineNum: 3,
      content: 'const c = 4;',
    });

    // context: old:3, new:4
    expect(lines[5]).toEqual({
      type: 'context',
      oldLineNum: 3,
      newLineNum: 4,
      content: 'const d = 5;',
    });
  });

  it('Case 2: new file (--- /dev/null)', () => {
    const raw = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+line 1',
      '+line 2',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('new.ts');
    expect(result[0].status).toBe('added');

    const lines = result[0].lines;
    expect(lines).toHaveLength(3); // hunk-header + 2 additions

    expect(lines[0].type).toBe('hunk-header');

    expect(lines[1]).toEqual({
      type: 'addition',
      oldLineNum: null,
      newLineNum: 1,
      content: 'line 1',
    });

    expect(lines[2]).toEqual({
      type: 'addition',
      oldLineNum: null,
      newLineNum: 2,
      content: 'line 2',
    });
  });

  it('Case 3: deleted file (+++ /dev/null)', () => {
    const raw = [
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('old.ts');
    expect(result[0].status).toBe('deleted');

    const lines = result[0].lines;
    expect(lines).toHaveLength(3); // hunk-header + 2 deletions

    expect(lines[0].type).toBe('hunk-header');

    expect(lines[1]).toEqual({
      type: 'deletion',
      oldLineNum: 1,
      newLineNum: null,
      content: 'line 1',
    });

    expect(lines[2]).toEqual({
      type: 'deletion',
      oldLineNum: 2,
      newLineNum: null,
      content: 'line 2',
    });
  });

  it('Case 4: multi-hunk file (line numbers reset per hunk)', () => {
    const raw = [
      'diff --git a/multi.ts b/multi.ts',
      '--- a/multi.ts',
      '+++ b/multi.ts',
      '@@ -1,3 +1,3 @@',
      ' a',
      '-b',
      '+B',
      ' c',
      '@@ -10,3 +10,3 @@',
      ' x',
      '-y',
      '+Y',
      ' z',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    const lines = result[0].lines;

    // First hunk
    expect(lines[0]).toEqual({
      type: 'hunk-header',
      oldLineNum: null,
      newLineNum: null,
      content: '@@ -1,3 +1,3 @@',
    });
    expect(lines[1]).toEqual({ type: 'context', oldLineNum: 1, newLineNum: 1, content: 'a' });
    expect(lines[2]).toEqual({ type: 'deletion', oldLineNum: 2, newLineNum: null, content: 'b' });
    expect(lines[3]).toEqual({ type: 'addition', oldLineNum: null, newLineNum: 2, content: 'B' });
    expect(lines[4]).toEqual({ type: 'context', oldLineNum: 3, newLineNum: 3, content: 'c' });

    // Second hunk - line numbers reset
    expect(lines[5]).toEqual({
      type: 'hunk-header',
      oldLineNum: null,
      newLineNum: null,
      content: '@@ -10,3 +10,3 @@',
    });
    expect(lines[6]).toEqual({ type: 'context', oldLineNum: 10, newLineNum: 10, content: 'x' });
    expect(lines[7]).toEqual({ type: 'deletion', oldLineNum: 11, newLineNum: null, content: 'y' });
    expect(lines[8]).toEqual({ type: 'addition', oldLineNum: null, newLineNum: 11, content: 'Y' });
    expect(lines[9]).toEqual({ type: 'context', oldLineNum: 12, newLineNum: 12, content: 'z' });
  });

  it('Case 5: rename detection', () => {
    const raw = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 90%',
      'rename from old-name.ts',
      'rename to new-name.ts',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('renamed');
    expect(result[0].filename).toBe('new-name.ts');
    expect(result[0].oldFilename).toBe('old-name.ts');
    expect(result[0].lines).toHaveLength(0);
  });

  it('Case 6: "No newline at end of file" markers are skipped', () => {
    const raw = [
      'diff --git a/noeof.ts b/noeof.ts',
      '--- a/noeof.ts',
      '+++ b/noeof.ts',
      '@@ -1,2 +1,2 @@',
      ' line 1',
      '-line 2',
      '\\ No newline at end of file',
      '+line 2 modified',
      '\\ No newline at end of file',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    const lines = result[0].lines;

    // Should have: hunk-header, context, deletion, addition = 4 lines (no backslash lines)
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => !l.content.includes('No newline'))).toBe(true);
  });

  it('Case 7: multiple files in one diff produce multiple DiffFile entries', () => {
    const raw = [
      'diff --git a/file1.ts b/file1.ts',
      '--- a/file1.ts',
      '+++ b/file1.ts',
      '@@ -1,1 +1,1 @@',
      '-old1',
      '+new1',
      'diff --git a/file2.ts b/file2.ts',
      '--- a/file2.ts',
      '+++ b/file2.ts',
      '@@ -1,1 +1,1 @@',
      '-old2',
      '+new2',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('file1.ts');
    expect(result[1].filename).toBe('file2.ts');

    // Each file should have hunk-header + deletion + addition = 3 lines
    expect(result[0].lines).toHaveLength(3);
    expect(result[1].lines).toHaveLength(3);
  });

  it('Case 8: empty diff returns empty array', () => {
    expect(parseDetailedDiff('')).toEqual([]);
    expect(parseDetailedDiff('   ')).toEqual([]);
    expect(parseDetailedDiff('\n\n')).toEqual([]);
  });

  it('handles rename with content changes', () => {
    const raw = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 80%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-remove',
      '+add',
    ].join('\n');

    const result = parseDetailedDiff(raw);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('renamed');
    expect(result[0].filename).toBe('new.ts');
    expect(result[0].oldFilename).toBe('old.ts');
    expect(result[0].lines).toHaveLength(4); // hunk-header + context + deletion + addition
  });

  it('handles hunk header with extra context text after @@', () => {
    const raw = [
      'diff --git a/func.ts b/func.ts',
      '--- a/func.ts',
      '+++ b/func.ts',
      '@@ -10,3 +10,3 @@ function hello() {',
      ' a',
      '-b',
      '+B',
      ' c',
    ].join('\n');

    const result = parseDetailedDiff(raw);
    const hunkHeader = result[0].lines[0];

    expect(hunkHeader.type).toBe('hunk-header');
    expect(hunkHeader.content).toBe('@@ -10,3 +10,3 @@ function hello() {');
  });
});
