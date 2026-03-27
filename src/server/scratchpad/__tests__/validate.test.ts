/**
 * Tests for validate.ts — format-specific content validation.
 */

import { validate } from '../validate.js';

describe('validate', () => {
  describe('text format', () => {
    it('always returns valid with line count', () => {
      expect(validate(['hello', 'world'], 'text')).toBe('Status: valid (2 lines)');
    });

    it('is valid for a single line', () => {
      expect(validate(['one'], 'text')).toBe('Status: valid (1 lines)');
    });
  });

  describe('empty content', () => {
    it('returns Status: empty for all formats', () => {
      for (const fmt of ['text', 'markdown', 'json', 'csv'] as const) {
        expect(validate([], fmt)).toBe('Status: empty');
      }
    });
  });

  describe('markdown format', () => {
    it('is valid with matched code fences', () => {
      const lines = ['# Title', '```js', 'const x = 1;', '```', 'Done'];
      expect(validate(lines, 'markdown')).toBe('Status: valid (5 lines)');
    });

    it('is valid with multiple fence pairs', () => {
      const lines = ['```', 'a', '```', '```', 'b', '```'];
      expect(validate(lines, 'markdown')).toBe('Status: valid (6 lines)');
    });

    it('is invalid with unclosed code fence', () => {
      const lines = ['Some text', '```python', 'print("hi")', 'more text'];
      const result = validate(lines, 'markdown');
      expect(result).toContain('invalid');
      expect(result).toContain('unclosed code fence');
    });

    it('reports the line number of the unclosed fence', () => {
      const lines = ['line 1', '```', 'inside'];
      // The fence is on line index 1, reported as line 2 (1-indexed)
      expect(validate(lines, 'markdown')).toBe('Status: invalid at line 2 — unclosed code fence');
    });

    it('is valid with no fences', () => {
      const lines = ['# Just a heading', 'Some paragraph text'];
      expect(validate(lines, 'markdown')).toBe('Status: valid (2 lines)');
    });

    it('handles indented code fences', () => {
      const lines = ['  ```', 'code', '  ```'];
      expect(validate(lines, 'markdown')).toBe('Status: valid (3 lines)');
    });
  });

  describe('json format', () => {
    it('is valid for valid JSON', () => {
      const lines = ['{', '  "key": "value"', '}'];
      expect(validate(lines, 'json')).toBe('Status: valid (3 lines)');
    });

    it('is valid for JSON array', () => {
      const lines = ['[1, 2, 3]'];
      expect(validate(lines, 'json')).toBe('Status: valid (1 lines)');
    });

    it('is invalid for malformed JSON', () => {
      const lines = ['{ "a": 1,', '"b": }'];
      const result = validate(lines, 'json');
      expect(result).toContain('invalid');
    });

    it('is invalid for completely broken JSON', () => {
      const lines = ['not json at all'];
      const result = validate(lines, 'json');
      expect(result).toContain('invalid');
    });

    it('is valid for simple primitives', () => {
      expect(validate(['"hello"'], 'json')).toBe('Status: valid (1 lines)');
      expect(validate(['42'], 'json')).toBe('Status: valid (1 lines)');
      expect(validate(['true'], 'json')).toBe('Status: valid (1 lines)');
      expect(validate(['null'], 'json')).toBe('Status: valid (1 lines)');
    });
  });

  describe('csv format', () => {
    it('is valid with consistent column count', () => {
      const lines = ['name,age,email', 'Alice,30,a@b.com', 'Bob,25,b@c.com'];
      expect(validate(lines, 'csv')).toBe('Status: valid (3 lines, 3 columns)');
    });

    it('is invalid with mismatched column count', () => {
      const lines = ['a,b,c', 'x,y'];
      const result = validate(lines, 'csv');
      expect(result).toContain('invalid');
      expect(result).toContain('expected 3 columns, got 2');
    });

    it('handles quoted fields with commas', () => {
      const lines = ['"name","address"', '"Alice","123 Main, Apt 4"'];
      // Both rows have 2 columns despite the comma inside quotes
      expect(validate(lines, 'csv')).toBe('Status: valid (2 lines, 2 columns)');
    });

    it('reports the correct line number for mismatches', () => {
      const lines = ['a,b', 'x,y', 'only_one'];
      const result = validate(lines, 'csv');
      expect(result).toContain('line 3');
      expect(result).toContain('expected 2 columns, got 1');
    });

    it('is valid for single-column CSV', () => {
      const lines = ['header', 'row1', 'row2'];
      expect(validate(lines, 'csv')).toBe('Status: valid (3 lines, 1 columns)');
    });

    it('skips blank lines when checking columns', () => {
      const lines = ['a,b', '', 'x,y'];
      expect(validate(lines, 'csv')).toBe('Status: valid (3 lines, 2 columns)');
    });

    it('is valid when all lines are blank', () => {
      const lines = ['', '  ', ''];
      expect(validate(lines, 'csv')).toBe('Status: valid (3 lines)');
    });
  });
});
