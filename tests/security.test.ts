/**
 * Security regression test suite.
 *
 * Covers all 5 fix categories from Phase 19 (Security Hardening):
 *   INP - Input Validation
 *   SUB - Subprocess Hardening
 *   CRED - Credential Safety
 *   API - API Blast Radius
 *   CLN - Cleanup
 *
 * Tests call actual module functions with malicious inputs (integration-level)
 * and use static analysis (fs.readFileSync) to verify security measures
 * remain in the source code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { validateGitArg, getClonePath } from '../src/cloner.js';
import { scrubSecrets, sanitizeError } from '../src/errors.js';

const SRC_DIR = resolve(import.meta.dirname, '..', 'src');

// ─── INP: Input Validation ───────────────────────────────────────────────────

describe('INP - Input Validation', () => {
  describe('validateGitArg rejects dangerous inputs', () => {
    it('rejects branch names starting with --upload-pack=evil', () => {
      expect(() => validateGitArg('--upload-pack=evil', 'Branch name')).toThrow('starts with a dash');
    });

    it('rejects branch names starting with --config=evil', () => {
      expect(() => validateGitArg('--config=evil', 'Branch name')).toThrow('starts with a dash');
    });

    it('rejects repo names containing path traversal (../../etc/passwd)', () => {
      expect(() => validateGitArg('../../etc/passwd', 'Repository name')).toThrow('path traversal');
    });

    it('rejects names containing null bytes (repo\\0name)', () => {
      expect(() => validateGitArg('repo\0name', 'Repository name')).toThrow('null byte');
    });

    it('rejects empty values', () => {
      expect(() => validateGitArg('', 'Repository name')).toThrow('is empty');
    });
  });

  describe('validateGitArg accepts valid GitHub names', () => {
    it('accepts repo name with dots: my.repo', () => {
      expect(() => validateGitArg('my.repo', 'Repository name')).not.toThrow();
    });

    it('accepts branch name with nested slashes: feature/nested/branch', () => {
      expect(() => validateGitArg('feature/nested/branch', 'Branch name')).not.toThrow();
    });

    it('accepts dotfile-style name: .github', () => {
      expect(() => validateGitArg('.github', 'Repository name')).not.toThrow();
    });

    it('accepts org name with hyphens: my-org', () => {
      expect(() => validateGitArg('my-org', 'Repository owner')).not.toThrow();
    });
  });

  describe('getClonePath rejects unsafe repo names', () => {
    it('rejects repo names with forward slash', () => {
      expect(() => getClonePath('bad/name')).toThrow('unsafe path characters');
    });

    it('rejects repo names with backslash', () => {
      expect(() => getClonePath('bad\\name')).toThrow('unsafe path characters');
    });

    it('rejects repo names with path traversal (..)', () => {
      expect(() => getClonePath('..')).toThrow('unsafe path characters');
    });

    it('rejects empty repo names', () => {
      expect(() => getClonePath('')).toThrow('unsafe path characters');
    });
  });

  describe('getClonePath accepts valid repo names', () => {
    it('accepts a normal repo name and returns path under .codereview/', () => {
      const result = getClonePath('my-repo');
      expect(result).toContain('.codereview');
      expect(result).toContain('my-repo');
    });

    it('accepts repo names with dots', () => {
      expect(() => getClonePath('my.repo')).not.toThrow();
    });

    it('accepts repo names with hyphens', () => {
      expect(() => getClonePath('my-cool-repo')).not.toThrow();
    });
  });
});

// ─── SUB: Subprocess Hardening ───────────────────────────────────────────────

describe('SUB - Subprocess Hardening', () => {
  it('html-report.ts uses execFile, not exec() with string interpolation', () => {
    const source = readFileSync(join(SRC_DIR, 'html-report.ts'), 'utf-8');

    // Must contain execFile (the safe pattern)
    expect(source).toContain('execFile');

    // Must NOT contain the dangerous pattern: exec( with backtick string
    // The dangerous pattern is importing exec from child_process and calling exec(`...`)
    // Check that there is no ` exec(` call (with backtick template literal or string concat)
    const dangerousExecPattern = /\bexec\s*\(/g;
    const execMatches = source.match(dangerousExecPattern) || [];

    // Filter out execFile matches -- only bare exec( is dangerous
    const bareExecCalls = execMatches.filter(m => !m.includes('execFile'));
    // All exec( references should be execFile(
    const allExecCalls = [...source.matchAll(/\b(exec|execFile)\s*\(/g)];
    const nonExecFileCalls = allExecCalls.filter(m => m[1] === 'exec');
    expect(nonExecFileCalls.length).toBe(0);
  });

  it('no src/ file contains shell: true', () => {
    const srcFiles = readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
    for (const file of srcFiles) {
      const source = readFileSync(join(SRC_DIR, file), 'utf-8');
      expect(source).not.toContain('shell: true');
    }
  });

  it('analyzer.ts env filtering strips AWS_SECRET_KEY but keeps required vars', () => {
    // This is a static analysis test since filterEnv is not exported.
    // Verify the implementation has the correct blocklist and keep-list.
    const source = readFileSync(join(SRC_DIR, 'analyzer.ts'), 'utf-8');

    // Verify dangerous prefixes are listed
    expect(source).toContain("'AWS_'");
    expect(source).toContain("'AZURE_'");
    expect(source).toContain("'GCP_'");
    expect(source).toContain("'SECRET_'");
    expect(source).toContain("'PASSWORD_'");

    // Verify keep-list includes required vars
    expect(source).toContain("'ANTHROPIC_API_KEY'");
    expect(source).toContain("'GH_TOKEN'");
    expect(source).toContain("'GITHUB_TOKEN'");

    // Verify filterEnv is used in the spawn call for agentic analysis
    expect(source).toContain('env: filterEnv()');
  });
});

// ─── CRED: Credential Safety ─────────────────────────────────────────────────

describe('CRED - Credential Safety', () => {
  describe('scrubSecrets redacts known token patterns', () => {
    it('redacts GitHub classic token (ghp_)', () => {
      const result = scrubSecrets('found ghp_1234567890abcdef in logs');
      expect(result).not.toContain('ghp_1234567890abcdef');
      expect(result).toContain('[REDACTED]');
      expect(result).toContain('found');
      expect(result).toContain('in logs');
    });

    it('redacts GitHub fine-grained PAT (github_pat_)', () => {
      expect(scrubSecrets('pat is github_pat_abcdef123')).toBe('pat is [REDACTED]');
    });

    it('redacts Anthropic API key (sk-ant-)', () => {
      expect(scrubSecrets('key is sk-ant-abc123-def456')).toBe('key is [REDACTED]');
    });

    it('redacts Bearer header with token', () => {
      expect(scrubSecrets('Bearer ghp_abc123')).toBe('Bearer [REDACTED]');
    });

    it('redacts token header', () => {
      expect(scrubSecrets('token ghp_abc123')).toBe('token [REDACTED]');
    });

    it('redacts URL-embedded credentials', () => {
      const input = 'https://user:ghp_abc123@github.com';
      const result = scrubSecrets(input);
      expect(result).toContain('https://[REDACTED]@');
      expect(result).not.toContain('ghp_abc123');
    });
  });

  describe('sanitizeError scrubs tokens from Error objects', () => {
    it('scrubs tokens from error message', () => {
      const error = new Error('Auth failed with token ghp_secret123456789');
      const result = sanitizeError(error);
      expect(result).not.toContain('ghp_secret123456789');
      expect(result).toContain('[REDACTED]');
    });

    it('passes through normal error messages unchanged', () => {
      const error = new Error('File not found: /tmp/test.txt');
      expect(sanitizeError(error)).toBe('File not found: /tmp/test.txt');
    });

    it('handles non-Error values', () => {
      expect(sanitizeError('simple string error')).toBe('simple string error');
      expect(sanitizeError(42)).toBe('42');
    });
  });

  describe('mixed content: tokens redacted, rest preserved', () => {
    it('scrubs token in a mixed message while preserving the rest', () => {
      const input = 'Failed to fetch https://api.github.com with token ghp_secret123';
      const result = scrubSecrets(input);
      expect(result).toContain('Failed to fetch');
      expect(result).toContain('api.github.com');
      expect(result).not.toContain('ghp_secret123');
      expect(result).toContain('[REDACTED]');
    });

    it('handles multiple tokens in the same string', () => {
      const input = 'ghp_token1 and sk-ant-key2-abc plus github_pat_xyz789';
      const result = scrubSecrets(input);
      expect(result).not.toContain('ghp_token1');
      expect(result).not.toContain('sk-ant-key2-abc');
      expect(result).not.toContain('github_pat_xyz789');
    });
  });
});

// ─── API: API Blast Radius ───────────────────────────────────────────────────

describe('API - API Safety', () => {
  it('github.ts only uses safe Octokit methods (pulls.get, pulls.listFiles, pulls.createReview)', () => {
    const source = readFileSync(join(SRC_DIR, 'github.ts'), 'utf-8');

    // Find all octokit method calls: octokit.pulls.X or octokit.rest.X
    const octokitCalls = [...source.matchAll(/octokit\.(?:rest\.)?(\w+\.\w+)/g)];
    const methodNames = octokitCalls.map(m => m[1]);

    const allowedMethods = new Set(['pulls.get', 'pulls.listFiles', 'pulls.createReview']);
    for (const method of methodNames) {
      expect(allowedMethods.has(method)).toBe(true);
    }

    // Verify at least the 3 expected methods are present
    expect(methodNames).toContain('pulls.get');
    expect(methodNames).toContain('pulls.listFiles');
    expect(methodNames).toContain('pulls.createReview');
  });

  it('github.ts, cloner.ts, and prerequisites.ts only invoke safe gh CLI subcommands', () => {
    const filesToCheck = ['github.ts', 'cloner.ts', 'prerequisites.ts'];
    const allowedSubcommands = new Set(['auth token', 'auth status', 'repo clone']);

    for (const file of filesToCheck) {
      const source = readFileSync(join(SRC_DIR, file), 'utf-8');

      // Find gh CLI invocations: execFile/execFileSync with 'gh' as command
      // Look for patterns like: execFile('gh', [...]) or execFileSync('gh', [...])
      const ghInvocations = [...source.matchAll(/execFile(?:Sync)?\(\s*'gh'\s*,\s*\[([^\]]+)\]/g)];

      for (const match of ghInvocations) {
        const argsStr = match[1];
        // Extract the first two string arguments to determine the subcommand
        const args = [...argsStr.matchAll(/'([^']+)'/g)].map(m => m[1]);
        const subcommand = args.slice(0, 2).join(' ');
        expect(allowedSubcommands).toContain(subcommand);
      }
    }
  });

  it('createReview call does NOT pass an event parameter (stays PENDING)', () => {
    const source = readFileSync(join(SRC_DIR, 'github.ts'), 'utf-8');

    // Find the createReview call blocks and verify none contain 'event:'
    // The createReview calls pass an object literal. Ensure no `event:` property.
    const createReviewBlocks = source.split('createReview(');
    // Skip the first split part (before the first createReview call)
    for (let i = 1; i < createReviewBlocks.length; i++) {
      const block = createReviewBlocks[i];
      // Take content up to the closing of the object (within reasonable bounds)
      const objectContent = block.slice(0, 500);
      expect(objectContent).not.toMatch(/\bevent\s*:/);
    }
  });

  it('agentic prompt contains security guardrails blocking destructive operations', () => {
    const source = readFileSync(join(SRC_DIR, 'prompt.ts'), 'utf-8');

    // Verify the prompt contains explicit NEVER rules for destructive operations
    expect(source).toContain('NEVER');
    expect(source).toMatch(/push/i);
    expect(source).toMatch(/merge/i);
    expect(source).toMatch(/delete/i);
    expect(source).toMatch(/close/i);
    expect(source).toMatch(/approve/i);
  });

  it('SECURITY.md exists and contains Accepted Risks section', () => {
    const projectRoot = resolve(import.meta.dirname, '..');
    const securityMd = readFileSync(join(projectRoot, 'SECURITY.md'), 'utf-8');

    expect(securityMd).toContain('Accepted Risk');
  });
});

// ─── CLN: Cleanup ────────────────────────────────────────────────────────────

describe('CLN - Cleanup', () => {
  it('cli.ts registers a SIGINT handler', () => {
    const source = readFileSync(join(SRC_DIR, 'cli.ts'), 'utf-8');
    expect(source).toMatch(/process\.on\(\s*'SIGINT'/);
  });

  it('cli.ts has try/finally safety net for clone cleanup', () => {
    const source = readFileSync(join(SRC_DIR, 'cli.ts'), 'utf-8');

    // Verify activeClonePath tracking exists
    expect(source).toContain('activeClonePath');

    // Verify rmSync is used in cleanup paths
    expect(source).toContain('rmSync');

    // Verify try/finally blocks exist
    expect(source).toContain('try');
    expect(source).toContain('finally');
  });

  it('cloner.ts removes git remote origin after clone', () => {
    const source = readFileSync(join(SRC_DIR, 'cloner.ts'), 'utf-8');
    expect(source).toContain('remote');
    expect(source).toContain('remove');
    expect(source).toContain('origin');

    // Verify the exact git command pattern
    expect(source).toMatch(/git.*remote.*remove.*origin/s);
  });

  it('cloner.ts creates clone directories with 0o700 permissions', () => {
    const source = readFileSync(join(SRC_DIR, 'cloner.ts'), 'utf-8');
    expect(source).toContain('0o700');
  });
});
