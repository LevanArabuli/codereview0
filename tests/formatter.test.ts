import { describe, it, expect } from 'vitest';
import { formatInlineComment, capitalizeSeverity } from '../src/formatter.js';
import type { ReviewFinding } from '../src/schemas.js';

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 10,
    severity: 'bug',
    confidence: 'high',
    category: 'Logic Error',
    description: 'Variable is reassigned incorrectly.',
    ...overrides,
  };
}

describe('capitalizeSeverity', () => {
  it('capitalizes first letter of severity string', () => {
    expect(capitalizeSeverity('bug')).toBe('Bug');
    expect(capitalizeSeverity('security')).toBe('Security');
    expect(capitalizeSeverity('suggestion')).toBe('Suggestion');
    expect(capitalizeSeverity('nitpick')).toBe('Nitpick');
  });
});

describe('formatInlineComment', () => {
  it('does NOT include confidence label for high confidence finding', () => {
    const finding = makeFinding({ confidence: 'high' });
    const result = formatInlineComment(finding);
    expect(result).not.toContain('[high]');
  });

  it('includes confidence label for medium confidence finding', () => {
    const finding = makeFinding({ confidence: 'medium' });
    const result = formatInlineComment(finding);
    expect(result).toContain('`[medium]`');
  });

  it('includes confidence label for low confidence finding', () => {
    const finding = makeFinding({ confidence: 'low' });
    const result = formatInlineComment(finding);
    expect(result).toContain('`[low]`');
  });

  it('preserves severity label', () => {
    const finding = makeFinding({ severity: 'bug', confidence: 'high' });
    const result = formatInlineComment(finding);
    expect(result).toContain('**Bug**');
  });

  it('includes description text', () => {
    const finding = makeFinding({ description: 'Missing null check on user object.' });
    const result = formatInlineComment(finding);
    expect(result).toContain('Missing null check on user object.');
  });

  it('includes related locations when present', () => {
    const finding = makeFinding({
      relatedLocations: [
        { file: 'src/bar.ts', line: 5, reason: 'Also used here' },
      ],
    });
    const result = formatInlineComment(finding);
    expect(result).toContain('**Related:**');
    expect(result).toContain('`src/bar.ts:5`');
    expect(result).toContain('Also used here');
  });

  it('includes suggested fix when present', () => {
    const finding = makeFinding({
      suggestedFix: 'const x = y ?? defaultValue;',
    });
    const result = formatInlineComment(finding);
    expect(result).toContain('```suggestion');
    expect(result).toContain('const x = y ?? defaultValue;');
  });

  it('medium confidence finding has severity then confidence label in order', () => {
    const finding = makeFinding({ severity: 'suggestion', confidence: 'medium' });
    const result = formatInlineComment(finding);
    // The line should be: **Suggestion** `[medium]`
    expect(result).toMatch(/\*\*Suggestion\*\* `\[medium\]`/);
  });
});
