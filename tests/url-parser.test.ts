import { describe, it, expect } from 'vitest';
import { parsePRUrl } from '../src/url-parser.js';

describe('parsePRUrl', () => {
  describe('valid URLs', () => {
    it('parses a standard GitHub PR URL', () => {
      const result = parsePRUrl('https://github.com/facebook/react/pull/42');
      expect(result).toEqual({ owner: 'facebook', repo: 'react', prNumber: 42 });
    });

    it('parses a URL with trailing slash', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/123/');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 123 });
    });

    it('parses a URL with query parameters', () => {
      const result = parsePRUrl(
        'https://github.com/owner/repo/pull/456?diff=unified&w=1'
      );
      expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 456 });
    });

    it('parses a URL with hash fragment', () => {
      const result = parsePRUrl(
        'https://github.com/owner/repo/pull/789#discussion_r12345'
      );
      expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 789 });
    });

    it('parses a URL with both query and hash', () => {
      const result = parsePRUrl(
        'https://github.com/owner/repo/pull/100?diff=split#pullrequestreview-1'
      );
      expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 100 });
    });

    it('parses http (non-https) URLs', () => {
      const result = parsePRUrl('http://github.com/owner/repo/pull/55');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 55 });
    });
  });

  describe('edge case repo/owner names', () => {
    it('handles dots in repo name', () => {
      const result = parsePRUrl('https://github.com/facebook/react.js/pull/10');
      expect(result).toEqual({ owner: 'facebook', repo: 'react.js', prNumber: 10 });
    });

    it('handles hyphens in repo name', () => {
      const result = parsePRUrl('https://github.com/my-org/my-repo/pull/5');
      expect(result).toEqual({ owner: 'my-org', repo: 'my-repo', prNumber: 5 });
    });

    it('handles underscores in repo name', () => {
      const result = parsePRUrl('https://github.com/org/my_repo/pull/7');
      expect(result).toEqual({ owner: 'org', repo: 'my_repo', prNumber: 7 });
    });

    it('handles dots in owner name', () => {
      const result = parsePRUrl('https://github.com/user.name/repo/pull/3');
      expect(result).toEqual({ owner: 'user.name', repo: 'repo', prNumber: 3 });
    });

    it('handles mixed special characters', () => {
      const result = parsePRUrl(
        'https://github.com/my-org.io/my_repo.js/pull/999'
      );
      expect(result).toEqual({
        owner: 'my-org.io',
        repo: 'my_repo.js',
        prNumber: 999,
      });
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parsePRUrl('')).toBeNull();
    });

    it('returns null for random text', () => {
      expect(parsePRUrl('not a url at all')).toBeNull();
    });

    it('returns null for github.com without path', () => {
      expect(parsePRUrl('https://github.com')).toBeNull();
    });

    it('returns null for github.com with only owner/repo', () => {
      expect(parsePRUrl('https://github.com/owner/repo')).toBeNull();
    });

    it('returns null for wrong domain', () => {
      expect(parsePRUrl('https://gitlab.com/owner/repo/pull/1')).toBeNull();
    });

    it('returns null for missing PR number', () => {
      expect(parsePRUrl('https://github.com/owner/repo/pull/')).toBeNull();
    });

    it('returns null for non-numeric PR number', () => {
      expect(parsePRUrl('https://github.com/owner/repo/pull/abc')).toBeNull();
    });

    it('returns null for shorthand reference', () => {
      expect(parsePRUrl('owner/repo#123')).toBeNull();
    });

    it('returns null for issues URL (not pull)', () => {
      expect(parsePRUrl('https://github.com/owner/repo/issues/42')).toBeNull();
    });

    it('returns null for PR files tab URL', () => {
      expect(
        parsePRUrl('https://github.com/owner/repo/pull/42/files')
      ).toBeNull();
    });

    it('returns null for PR commits tab URL', () => {
      expect(
        parsePRUrl('https://github.com/owner/repo/pull/42/commits')
      ).toBeNull();
    });
  });

  describe('extracted values', () => {
    it('correctly extracts owner', () => {
      const result = parsePRUrl('https://github.com/anthropics/claude-code/pull/1');
      expect(result?.owner).toBe('anthropics');
    });

    it('correctly extracts repo', () => {
      const result = parsePRUrl('https://github.com/anthropics/claude-code/pull/1');
      expect(result?.repo).toBe('claude-code');
    });

    it('correctly extracts prNumber as a number', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/9999');
      expect(result?.prNumber).toBe(9999);
      expect(typeof result?.prNumber).toBe('number');
    });
  });
});
