import { requireEmail, requireString, clamp } from '../../../server/handlers/validate.js';

describe('requireEmail', () => {
  it('returns valid email', () => {
    expect(requireEmail({ email: 'user@example.com' })).toBe('user@example.com');
  });

  it('rejects missing email', () => {
    expect(() => requireEmail({})).toThrow('valid email');
  });

  it('rejects non-string email', () => {
    expect(() => requireEmail({ email: 42 })).toThrow('valid email');
    expect(() => requireEmail({ email: null })).toThrow('valid email');
    expect(() => requireEmail({ email: undefined })).toThrow('valid email');
  });

  it('rejects empty string', () => {
    expect(() => requireEmail({ email: '' })).toThrow('valid email');
  });

  it('rejects path traversal attempts', () => {
    expect(() => requireEmail({ email: '../etc/passwd' })).toThrow('valid email');
    expect(() => requireEmail({ email: '../../shadow' })).toThrow('valid email');
  });

  it('rejects emails without domain', () => {
    expect(() => requireEmail({ email: 'user@' })).toThrow('valid email');
    expect(() => requireEmail({ email: '@example.com' })).toThrow('valid email');
  });

  it('rejects emails with spaces', () => {
    expect(() => requireEmail({ email: 'user @example.com' })).toThrow('valid email');
  });

  it('accepts plus-addressed emails', () => {
    expect(requireEmail({ email: 'user+tag@example.com' })).toBe('user+tag@example.com');
  });

  it('accepts dotted local parts', () => {
    expect(requireEmail({ email: 'first.last@example.com' })).toBe('first.last@example.com');
  });

  it('accepts hyphenated domains', () => {
    expect(requireEmail({ email: 'user@my-domain.co.uk' })).toBe('user@my-domain.co.uk');
  });
});

describe('requireString', () => {
  it('returns valid string', () => {
    expect(requireString({ name: 'hello' }, 'name')).toBe('hello');
  });

  it('rejects missing field', () => {
    expect(() => requireString({}, 'name')).toThrow('name');
  });

  it('rejects non-string values', () => {
    expect(() => requireString({ n: 42 }, 'n')).toThrow('n');
    expect(() => requireString({ n: true }, 'n')).toThrow('n');
    expect(() => requireString({ n: null }, 'n')).toThrow('n');
  });

  it('rejects whitespace-only strings', () => {
    expect(() => requireString({ n: '   ' }, 'n')).toThrow('n');
    expect(() => requireString({ n: '\t\n' }, 'n')).toThrow('n');
  });

  it('accepts strings with leading/trailing whitespace and content', () => {
    expect(requireString({ n: '  hello  ' }, 'n')).toBe('  hello  ');
  });
});

describe('clamp', () => {
  it('returns default when value is undefined', () => {
    expect(clamp(undefined, 10, 50)).toBe(10);
  });

  it('returns default when value is null', () => {
    expect(clamp(null, 10, 50)).toBe(10);
  });

  it('returns default when value is NaN', () => {
    expect(clamp(NaN, 10, 50)).toBe(10);
    expect(clamp('not-a-number', 10, 50)).toBe(10);
  });

  it('returns default when value is 0 (falsy)', () => {
    // Number(0) is 0, which is falsy, so || defaultVal kicks in
    expect(clamp(0, 10, 50)).toBe(10);
  });

  it('clamps to max when value exceeds it', () => {
    expect(clamp(200, 10, 50)).toBe(50);
    expect(clamp(51, 10, 50)).toBe(50);
  });

  it('passes through values within range', () => {
    expect(clamp(25, 10, 50)).toBe(25);
    expect(clamp(1, 10, 50)).toBe(1);
    expect(clamp(50, 10, 50)).toBe(50);
  });

  it('handles negative values', () => {
    expect(clamp(-5, 10, 50)).toBe(-5);
  });

  it('coerces string numbers', () => {
    expect(clamp('25', 10, 50)).toBe(25);
    expect(clamp('100', 10, 50)).toBe(50);
  });
});
