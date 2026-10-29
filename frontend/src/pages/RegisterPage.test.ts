import { describe, expect, it } from 'vitest';
import { validateRegistration } from './RegisterPage';

describe('validateRegistration', () => {
  it('accepts valid input', () => {
    expect(validateRegistration('Ayesha', 'a@b.com', 'secret123', 'secret123')).toBeNull();
  });

  it.each([
    ['short name', ['A', 'a@b.com', 'secret123', 'secret123'], /name/i],
    ['bad email', ['Ayesha', 'not-email', 'secret123', 'secret123'], /email/i],
    ['short password', ['Ayesha', 'a@b.com', 'abc1', 'abc1'], /8 to 72/],
    ['password without a number', ['Ayesha', 'a@b.com', 'abcdefgh', 'abcdefgh'], /letter and a number/],
    ['mismatched passwords', ['Ayesha', 'a@b.com', 'secret123', 'secret124'], /do not match/],
  ] as const)('rejects %s', (_label, [name, email, pw, confirm], expected) => {
    expect(validateRegistration(name, email, pw, confirm)).toMatch(expected);
  });
});
