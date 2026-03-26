/**
 * Tests for ScratchpadManager — line-addressed content authoring buffer.
 * See ADR-301.
 */

import { ScratchpadManager } from '../manager.js';
import type { LiveBinding, MutationResult } from '../manager.js';

// ── Mock getEpoch ──────────────────────────────────────────
// The manager imports getEpoch from '../handler.js' which resolves
// to '../../handler.js' from the manager's location.

let mockEpoch = 0;

jest.mock('../../handler.js', () => ({
  getEpoch: () => mockEpoch,
}));

beforeEach(() => {
  mockEpoch = 0;
});

// ── Helpers ────────────────────────────────────────────────

function createManager(): ScratchpadManager {
  return new ScratchpadManager();
}

// ── 1. create() ────────────────────────────────────────────

describe('ScratchpadManager', () => {
  describe('create()', () => {
    it('creates an empty scratchpad with defaults', () => {
      const mgr = createManager();
      const id = mgr.create();
      expect(id).toMatch(/^sp-/);
      const sp = mgr.get(id);
      expect(sp).not.toBeNull();
      expect(sp!.lines).toEqual([]);
      expect(sp!.format).toBe('text');
      expect(sp!.label).toBeUndefined();
      expect(sp!.attachments.size).toBe(0);
    });

    it('creates a scratchpad with content', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'hello\nworld' });
      const sp = mgr.get(id)!;
      expect(sp.lines).toEqual(['hello', 'world']);
    });

    it('creates a scratchpad with a specific format', () => {
      const mgr = createManager();
      const id = mgr.create({ format: 'json' });
      expect(mgr.get(id)!.format).toBe('json');
    });

    it('creates a scratchpad with a label', () => {
      const mgr = createManager();
      const id = mgr.create({ label: 'Draft email' });
      expect(mgr.get(id)!.label).toBe('Draft email');
    });

    it('creates a scratchpad with all options combined', () => {
      const mgr = createManager();
      const id = mgr.create({
        content: '{"key": "value"}',
        format: 'json',
        label: 'Config',
      });
      const sp = mgr.get(id)!;
      expect(sp.lines).toEqual(['{"key": "value"}']);
      expect(sp.format).toBe('json');
      expect(sp.label).toBe('Config');
    });

    it('generates unique IDs for each scratchpad', () => {
      const mgr = createManager();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(mgr.create());
      }
      expect(ids.size).toBe(50);
    });
  });

  // ── 2. view() ──────────────────────────────────────────────

  describe('view()', () => {
    it('returns full view with header and line numbers', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'line one\nline two\nline three' });
      const view = mgr.view(id)!;
      expect(view).toContain(id);
      expect(view).toContain('text');
      expect(view).toContain('3 lines');
      expect(view).toContain('1 | line one');
      expect(view).toContain('2 | line two');
      expect(view).toContain('3 | line three');
    });

    it('returns windowed view for a line range', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc\nd\ne' });
      const view = mgr.view(id, 2, 4)!;
      expect(view).toContain('2 | b');
      expect(view).toContain('3 | c');
      expect(view).toContain('4 | d');
      expect(view).not.toContain('1 | a');
      expect(view).not.toContain('5 | e');
    });

    it('displays empty buffer message', () => {
      const mgr = createManager();
      const id = mgr.create();
      const view = mgr.view(id)!;
      expect(view).toContain('(empty buffer)');
    });

    it('returns null for unknown id', () => {
      const mgr = createManager();
      expect(mgr.view('sp-nonexistent')).toBeNull();
    });

    it('clamps window boundaries', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc' });
      // startLine below 1 gets clamped to 1, endLine above length clamped
      const view = mgr.view(id, -5, 100)!;
      expect(view).toContain('1 | a');
      expect(view).toContain('3 | c');
    });

    it('includes label in header when present', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'x', label: 'My Label' });
      const view = mgr.view(id)!;
      expect(view).toContain('"My Label"');
    });

    it('includes attachment count in header', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'x' });
      mgr.attach(id, {
        source: 'drive',
        filename: 'file.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        location: 'drive://abc',
      });
      const view = mgr.view(id)!;
      expect(view).toContain('1 attachment(s)');
    });

    it('includes binding info in header', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'x' });
      mgr.setBinding(id, { service: 'docs', resourceId: 'doc123', account: 'a@b.com' });
      const view = mgr.view(id)!;
      expect(view).toContain('bound: docs/doc123');
    });
  });

  // ── 3. Line operations ─────────────────────────────────────

  describe('insertLines()', () => {
    it('inserts after a given line', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nc' });
      const result = mgr.insertLines(id, 1, 'b')!;
      expect(result.message).toContain('Inserted 1 line(s)');
      expect(mgr.getContent(id)).toBe('a\nb\nc');
    });

    it('prepends when afterLine=0', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'b\nc' });
      mgr.insertLines(id, 0, 'a');
      expect(mgr.getContent(id)).toBe('a\nb\nc');
    });

    it('inserts multi-line content', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nd' });
      mgr.insertLines(id, 1, 'b\nc');
      expect(mgr.getContent(id)).toBe('a\nb\nc\nd');
    });

    it('returns error for afterLine out of range (negative)', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      const result = mgr.insertLines(id, -1, 'x')!;
      expect(result.message).toContain('Error');
      expect(result.message).toContain('out of range');
    });

    it('returns error for afterLine out of range (too high)', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      const result = mgr.insertLines(id, 5, 'x')!;
      expect(result.message).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.insertLines('sp-nope', 0, 'x')).toBeNull();
    });
  });

  describe('appendLines()', () => {
    it('appends to the end of the buffer', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      const result = mgr.appendLines(id, 'b\nc')!;
      expect(result.message).toContain('Appended 2 line(s)');
      expect(mgr.getContent(id)).toBe('a\nb\nc');
    });

    it('appends to an empty buffer', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.appendLines(id, 'first');
      expect(mgr.getContent(id)).toBe('first');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.appendLines('sp-nope', 'x')).toBeNull();
    });
  });

  describe('replaceLines()', () => {
    it('replaces a single line', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc' });
      const result = mgr.replaceLines(id, 2, 2, 'B')!;
      expect(result.message).toContain('Replaced lines 2-2');
      expect(mgr.getContent(id)).toBe('a\nB\nc');
    });

    it('replaces a range with more lines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc' });
      mgr.replaceLines(id, 2, 2, 'x\ny\nz');
      expect(mgr.getContent(id)).toBe('a\nx\ny\nz\nc');
    });

    it('replaces a range with fewer lines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc\nd' });
      mgr.replaceLines(id, 2, 3, 'X');
      expect(mgr.getContent(id)).toBe('a\nX\nd');
    });

    it('returns error for startLine out of range', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      const result = mgr.replaceLines(id, 0, 1, 'x')!;
      expect(result.message).toContain('Error');
    });

    it('returns error for endLine out of range', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb' });
      const result = mgr.replaceLines(id, 1, 5, 'x')!;
      expect(result.message).toContain('Error');
    });

    it('returns error when endLine < startLine', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc' });
      const result = mgr.replaceLines(id, 3, 1, 'x')!;
      expect(result.message).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.replaceLines('sp-nope', 1, 1, 'x')).toBeNull();
    });
  });

  describe('removeLines()', () => {
    it('removes a single line', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc' });
      const result = mgr.removeLines(id, 2)!;
      expect(result.message).toContain('Removed 1 line(s)');
      expect(mgr.getContent(id)).toBe('a\nc');
    });

    it('removes a range of lines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc\nd' });
      mgr.removeLines(id, 2, 3);
      expect(mgr.getContent(id)).toBe('a\nd');
    });

    it('removes all lines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb' });
      mgr.removeLines(id, 1, 2);
      expect(mgr.getContent(id)).toBe('');
    });

    it('returns error for startLine out of range', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      const result = mgr.removeLines(id, 0)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for endLine out of range', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb' });
      const result = mgr.removeLines(id, 1, 5)!;
      expect(result.message).toContain('Error');
    });

    it('returns context showing buffer now empty', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'only' });
      const result = mgr.removeLines(id, 1)!;
      expect(result.context).toContain('(buffer now empty)');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.removeLines('sp-nope', 1)).toBeNull();
    });
  });

  // ── 4. copyLines() ────────────────────────────────────────

  describe('copyLines()', () => {
    it('copies lines between scratchpads', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'alpha\nbeta\ngamma' });
      const tgt = mgr.create({ content: 'one\ntwo' });
      const result = mgr.copyLines(tgt, src, 1, 2, 1)!;
      expect(result.message).toContain('Copied 2 line(s)');
      expect(mgr.getContent(tgt)).toBe('one\nalpha\nbeta\ntwo');
    });

    it('does not modify the source scratchpad', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'a\nb\nc' });
      const tgt = mgr.create();
      mgr.copyLines(tgt, src, 1, 3, 0);
      expect(mgr.getContent(src)).toBe('a\nb\nc');
    });

    it('returns error for invalid source range', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'a' });
      const tgt = mgr.create();
      const result = mgr.copyLines(tgt, src, 0, 1, 0)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for source endLine out of range', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'a' });
      const tgt = mgr.create();
      const result = mgr.copyLines(tgt, src, 1, 5, 0)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for target afterLine out of range', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'a' });
      const tgt = mgr.create({ content: 'b' });
      const result = mgr.copyLines(tgt, src, 1, 1, 99)!;
      expect(result.message).toContain('Error');
    });

    it('returns error when source scratchpad does not exist', () => {
      const mgr = createManager();
      const tgt = mgr.create();
      const result = mgr.copyLines(tgt, 'sp-nonexistent', 1, 1, 0)!;
      expect(result.message).toContain('Error');
      expect(result.message).toContain('not found');
    });

    it('returns null when target scratchpad does not exist', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'a' });
      expect(mgr.copyLines('sp-nope', src, 1, 1, 0)).toBeNull();
    });

    it('copies to afterLine=0 (prepend)', () => {
      const mgr = createManager();
      const src = mgr.create({ content: 'x' });
      const tgt = mgr.create({ content: 'y' });
      mgr.copyLines(tgt, src, 1, 1, 0);
      expect(mgr.getContent(tgt)).toBe('x\ny');
    });
  });

  // ── 5. JSON path operations ────────────────────────────────

  describe('jsonGet()', () => {
    it('retrieves a value at a path', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": {"b": 42}}', format: 'json' });
      const result = mgr.jsonGet(id, '$.a.b')!;
      expect('value' in result).toBe(true);
      if ('value' in result) {
        expect(result.value).toBe(42);
      }
    });

    it('retrieves nested objects', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": {"b": {"c": true}}}', format: 'json' });
      const result = mgr.jsonGet(id, '$.a.b')!;
      if ('value' in result) {
        expect(result.value).toEqual({ c: true });
      }
    });

    it('retrieves array elements', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"items": [10, 20, 30]}', format: 'json' });
      const result = mgr.jsonGet(id, '$.items[1]')!;
      if ('value' in result) {
        expect(result.value).toBe(20);
      }
    });

    it('returns error for non-json format', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'hello', format: 'text' });
      const result = mgr.jsonGet(id, '$.foo')!;
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('json');
      }
    });

    it('returns error for invalid JSON in buffer', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{broken', format: 'json' });
      const result = mgr.jsonGet(id, '$.foo')!;
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('not valid JSON');
      }
    });

    it('returns error for bad path traversal', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1}', format: 'json' });
      const result = mgr.jsonGet(id, '$.a.b.c')!;
      expect('error' in result).toBe(true);
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.jsonGet('sp-nope', '$.a')).toBeNull();
    });
  });

  describe('jsonSet()', () => {
    it('sets a value at a path', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1}', format: 'json' });
      const result = mgr.jsonSet(id, '$.a', 99)!;
      expect(result.message).toContain('Set $.a');
      const content = mgr.getContent(id)!;
      expect(JSON.parse(content).a).toBe(99);
    });

    it('sets a nested value', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": {"b": 1}}', format: 'json' });
      mgr.jsonSet(id, '$.a.b', 'new');
      expect(JSON.parse(mgr.getContent(id)!).a.b).toBe('new');
    });

    it('returns error for non-json format', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'hello', format: 'text' });
      const result = mgr.jsonSet(id, '$.a', 1)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for invalid JSON in buffer', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{bad', format: 'json' });
      const result = mgr.jsonSet(id, '$.a', 1)!;
      expect(result.message).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.jsonSet('sp-nope', '$.a', 1)).toBeNull();
    });
  });

  describe('jsonDelete()', () => {
    it('deletes a key from an object', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1, "b": 2}', format: 'json' });
      const result = mgr.jsonDelete(id, '$.a')!;
      expect(result.message).toContain('Deleted $.a');
      const parsed = JSON.parse(mgr.getContent(id)!);
      expect(parsed.a).toBeUndefined();
      expect(parsed.b).toBe(2);
    });

    it('deletes an array element by index', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"items": [1, 2, 3]}', format: 'json' });
      mgr.jsonDelete(id, '$.items[1]');
      expect(JSON.parse(mgr.getContent(id)!).items).toEqual([1, 3]);
    });

    it('returns error for non-json format', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'x', format: 'text' });
      const result = mgr.jsonDelete(id, '$.a')!;
      expect(result.message).toContain('Error');
    });

    it('returns error for invalid JSON in buffer', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{bad', format: 'json' });
      const result = mgr.jsonDelete(id, '$.a')!;
      expect(result.message).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.jsonDelete('sp-nope', '$.a')).toBeNull();
    });
  });

  describe('jsonInsert()', () => {
    it('pushes a value into an array', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"items": [1, 2]}', format: 'json' });
      const result = mgr.jsonInsert(id, '$.items', 3)!;
      expect(result.message).toContain('Inserted into $.items');
      expect(JSON.parse(mgr.getContent(id)!).items).toEqual([1, 2, 3]);
    });

    it('returns error when target is not an array', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": "string"}', format: 'json' });
      const result = mgr.jsonInsert(id, '$.a', 'val')!;
      expect(result.message).toContain('not an array');
    });

    it('returns error for non-json format', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'x', format: 'text' });
      const result = mgr.jsonInsert(id, '$.a', 1)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for invalid JSON in buffer', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{bad', format: 'json' });
      const result = mgr.jsonInsert(id, '$.a', 1)!;
      expect(result.message).toContain('Error');
    });

    it('returns error for bad path', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1}', format: 'json' });
      const result = mgr.jsonInsert(id, '$.a.b.c', 1)!;
      expect(result.message).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.jsonInsert('sp-nope', '$.a', 1)).toBeNull();
    });
  });

  // ── 6. Attachments ─────────────────────────────────────────

  describe('attach()', () => {
    const sampleRef = {
      source: 'drive' as const,
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      location: 'drive://abc123',
    };

    it('attaches a file and inserts a marker line at the end', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'hello' });
      const result = mgr.attach(id, sampleRef)!;
      expect(result.refId).toBe('att-1');
      expect(result.message).toContain('report.pdf');
      expect(result.message).toContain('att-1');
      // Marker inserted at end (line 2)
      const sp = mgr.get(id)!;
      expect(sp.lines.length).toBe(2);
      expect(sp.lines[1]).toContain('att:att-1');
    });

    it('attaches a file after a specific line', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb' });
      mgr.attach(id, sampleRef, 1);
      const sp = mgr.get(id)!;
      expect(sp.lines.length).toBe(3);
      // Marker inserted between a and b
      expect(sp.lines[0]).toBe('a');
      expect(sp.lines[1]).toContain('report.pdf');
      expect(sp.lines[2]).toBe('b');
    });

    it('formats size in the marker (KB)', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.attach(id, { ...sampleRef, size: 2048 });
      const sp = mgr.get(id)!;
      expect(sp.lines[0]).toContain('2.0 KB');
    });

    it('formats size in the marker (MB)', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.attach(id, { ...sampleRef, size: 5 * 1024 * 1024 });
      const sp = mgr.get(id)!;
      expect(sp.lines[0]).toContain('5.0 MB');
    });

    it('formats size in bytes for small files', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.attach(id, { ...sampleRef, size: 500 });
      const sp = mgr.get(id)!;
      expect(sp.lines[0]).toContain('500 B');
    });

    it('increments refId for multiple attachments', () => {
      const mgr = createManager();
      const id = mgr.create();
      const r1 = mgr.attach(id, sampleRef)!;
      const r2 = mgr.attach(id, { ...sampleRef, filename: 'second.pdf' })!;
      expect(r1.refId).toBe('att-1');
      expect(r2.refId).toBe('att-2');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.attach('sp-nope', sampleRef)).toBeNull();
    });
  });

  describe('detach()', () => {
    it('removes attachment from side-table but leaves marker', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'hello' });
      mgr.attach(id, {
        source: 'drive',
        filename: 'file.pdf',
        mimeType: 'application/pdf',
        size: 100,
        location: 'x',
      });
      const result = mgr.detach(id, 'att-1')!;
      expect(result).toContain('Detached');
      expect(result).toContain('file.pdf');
      // Marker line still in buffer
      expect(mgr.get(id)!.lines.length).toBe(2);
      // But attachment removed from map
      expect(mgr.getAttachments(id)!.size).toBe(0);
    });

    it('returns error when refId not found', () => {
      const mgr = createManager();
      const id = mgr.create();
      const result = mgr.detach(id, 'att-999')!;
      expect(result).toContain('Error');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.detach('sp-nope', 'att-1')).toBeNull();
    });
  });

  describe('getAttachments()', () => {
    it('returns attachment map', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.attach(id, {
        source: 'workspace',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 10,
        location: '/a.txt',
      });
      const atts = mgr.getAttachments(id)!;
      expect(atts.size).toBe(1);
      expect(atts.get('att-1')!.filename).toBe('a.txt');
    });

    it('returns null for unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.getAttachments('sp-nope')).toBeNull();
    });
  });

  // ── 7. Live binding ────────────────────────────────────────

  describe('setBinding() / getBinding()', () => {
    const binding: LiveBinding = {
      service: 'docs',
      resourceId: 'doc-abc',
      account: 'user@example.com',
    };

    it('sets and retrieves a binding', () => {
      const mgr = createManager();
      const id = mgr.create();
      expect(mgr.setBinding(id, binding)).toBe(true);
      expect(mgr.getBinding(id)).toEqual(binding);
    });

    it('returns false for setBinding on unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.setBinding('sp-nope', binding)).toBe(false);
    });

    it('returns undefined for getBinding on unknown scratchpad', () => {
      const mgr = createManager();
      expect(mgr.getBinding('sp-nope')).toBeUndefined();
    });

    it('returns undefined when no binding is set', () => {
      const mgr = createManager();
      const id = mgr.create();
      expect(mgr.getBinding(id)).toBeUndefined();
    });
  });

  // ── 8. Format validation ──────────────────────────────────

  describe('format validation', () => {
    it('text format is always valid', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'anything goes {{{{', format: 'text' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: valid');
    });

    it('empty buffer shows status empty', () => {
      const mgr = createManager();
      const id = mgr.create({ format: 'json' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: empty');
    });

    it('markdown detects unclosed code fence', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '# Title\n```js\ncode', format: 'markdown' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: invalid');
      expect(view).toContain('unclosed code fence');
    });

    it('markdown is valid with matched fences', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '```\ncode\n```', format: 'markdown' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: valid');
    });

    it('json shows parse error with line info', () => {
      const mgr = createManager();
      // Missing closing brace — error at some position
      const id = mgr.create({ content: '{\n  "a": 1,\n  "b":\n}', format: 'json' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: invalid');
    });

    it('json is valid for correct JSON', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1}', format: 'json' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: valid');
    });

    it('csv detects column inconsistency', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a,b,c\n1,2\n3,4,5', format: 'csv' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: invalid');
      expect(view).toContain('expected 3 columns, got 2');
    });

    it('csv is valid with consistent columns', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a,b,c\n1,2,3\n4,5,6', format: 'csv' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: valid');
      expect(view).toContain('3 columns');
    });

    it('csv handles quoted fields with commas', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'name,value\n"Smith, John",42', format: 'csv' });
      const view = mgr.view(id)!;
      expect(view).toContain('Status: valid');
      expect(view).toContain('2 columns');
    });
  });

  // ── 9. Epoch-based GC ─────────────────────────────────────

  describe('epoch-based garbage collection', () => {
    it('scratchpad is accessible when epoch is within range', () => {
      const mgr = createManager();
      mockEpoch = 10;
      const id = mgr.create();
      mockEpoch = 110; // 100 epochs later — exactly at boundary
      expect(mgr.get(id)).not.toBeNull();
    });

    it('scratchpad expires after 100 epochs without touch', () => {
      const mgr = createManager();
      mockEpoch = 0;
      const id = mgr.create();
      mockEpoch = 101; // 101 > 100, expired
      expect(mgr.get(id)).toBeNull();
    });

    it('touching a scratchpad resets its epoch', () => {
      const mgr = createManager();
      mockEpoch = 0;
      const id = mgr.create({ content: 'data' });
      mockEpoch = 50;
      mgr.view(id); // touches it, resetting to epoch 50
      mockEpoch = 150; // 100 from creation, but only 100 from touch — at boundary
      expect(mgr.get(id)).not.toBeNull();
      mockEpoch = 151; // now expired
      expect(mgr.get(id)).toBeNull();
    });

    it('gc runs during create() and removes expired pads', () => {
      const mgr = createManager();
      mockEpoch = 0;
      const old = mgr.create({ label: 'old' });
      mockEpoch = 200;
      mgr.create({ label: 'new' }); // triggers gc
      expect(mgr.get(old)).toBeNull();
    });

    it('gc runs during list() and removes expired pads', () => {
      const mgr = createManager();
      mockEpoch = 0;
      mgr.create({ label: 'old' });
      mockEpoch = 200;
      const items = mgr.list();
      expect(items.length).toBe(0);
    });

    it('mutation operations touch the scratchpad', () => {
      const mgr = createManager();
      mockEpoch = 0;
      const id = mgr.create({ content: 'a' });
      mockEpoch = 50;
      mgr.appendLines(id, 'b'); // touch at 50
      mockEpoch = 150;
      expect(mgr.get(id)).not.toBeNull(); // 150 - 50 = 100, at boundary
      mockEpoch = 151;
      expect(mgr.get(id)).toBeNull();
    });
  });

  // ── 10. Mutation response format ──────────────────────────

  describe('mutation response format', () => {
    it('includes context markers showing affected lines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb\nc\nd\ne' });
      const result = mgr.insertLines(id, 2, 'x')!;
      // Context should show surrounding lines
      expect(result.context).toBeTruthy();
      expect(result.context).toContain('x');
    });

    it('includes validation status in every mutation result', () => {
      const mgr = createManager();
      const id = mgr.create({ content: '{"a": 1}', format: 'json' });
      const result = mgr.appendLines(id, '"b": 2}')!;
      expect(result.validation).toBeTruthy();
      // After appending broken JSON, validation should flag it
      expect(result.validation).toContain('Status:');
    });

    it('context elides middle for large insertions', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'before\nafter' });
      const result = mgr.insertLines(id, 1, 'x\ny\nz')!;
      // 3 affected lines — the middle should be elided (> 2 affected)
      expect(result.context).toContain('...');
    });

    it('context shows one line before and after', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'before\nold\nafter' });
      const result = mgr.replaceLines(id, 2, 2, 'new')!;
      expect(result.context).toContain('before');
      expect(result.context).toContain('new');
      expect(result.context).toContain('after');
    });
  });

  // ── 11. CRLF normalization ─────────────────────────────────

  describe('CRLF normalization', () => {
    it('normalizes CRLF to LF on create', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'line1\r\nline2\r\nline3' });
      expect(mgr.get(id)!.lines).toEqual(['line1', 'line2', 'line3']);
    });

    it('normalizes CR to LF on create', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'line1\rline2' });
      expect(mgr.get(id)!.lines).toEqual(['line1', 'line2']);
    });

    it('normalizes CRLF on insertLines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a' });
      mgr.insertLines(id, 1, 'b\r\nc');
      expect(mgr.getContent(id)).toBe('a\nb\nc');
    });

    it('normalizes CRLF on appendLines', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.appendLines(id, 'x\r\ny');
      expect(mgr.getContent(id)).toBe('x\ny');
    });

    it('normalizes CRLF on replaceLines', () => {
      const mgr = createManager();
      const id = mgr.create({ content: 'a\nb' });
      mgr.replaceLines(id, 1, 1, 'x\r\ny');
      expect(mgr.getContent(id)).toBe('x\ny\nb');
    });
  });

  // ── 12. discard() and list() lifecycle ─────────────────────

  describe('discard() and list()', () => {
    it('discard removes a scratchpad', () => {
      const mgr = createManager();
      const id = mgr.create();
      expect(mgr.discard(id)).toBe(true);
      expect(mgr.get(id)).toBeNull();
    });

    it('discard returns false for unknown id', () => {
      const mgr = createManager();
      expect(mgr.discard('sp-nonexistent')).toBe(false);
    });

    it('list returns summaries of all active scratchpads', () => {
      const mgr = createManager();
      mgr.create({ label: 'first', content: 'a\nb', format: 'text' });
      mgr.create({ label: 'second', format: 'json' });
      const items = mgr.list();
      expect(items.length).toBe(2);
      expect(items[0].label).toBe('first');
      expect(items[0].lineCount).toBe(2);
      expect(items[0].format).toBe('text');
      expect(items[0].bound).toBe(false);
      expect(items[1].label).toBe('second');
      expect(items[1].lineCount).toBe(0);
    });

    it('list excludes discarded scratchpads', () => {
      const mgr = createManager();
      const id1 = mgr.create({ label: 'keep' });
      const id2 = mgr.create({ label: 'drop' });
      mgr.discard(id2);
      const items = mgr.list();
      expect(items.length).toBe(1);
      expect(items[0].label).toBe('keep');
    });

    it('list includes validation status', () => {
      const mgr = createManager();
      mgr.create({ content: '{"a": 1}', format: 'json' });
      const items = mgr.list();
      expect(items[0].validation).toContain('Status: valid');
    });

    it('list includes attachment count', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.attach(id, {
        source: 'drive',
        filename: 'f.txt',
        mimeType: 'text/plain',
        size: 10,
        location: 'x',
      });
      const items = mgr.list();
      expect(items[0].attachmentCount).toBe(1);
    });

    it('list shows bound status', () => {
      const mgr = createManager();
      const id = mgr.create();
      mgr.setBinding(id, { service: 'sheets', resourceId: 's1', account: 'a@b.com' });
      const items = mgr.list();
      expect(items[0].bound).toBe(true);
    });
  });
});
