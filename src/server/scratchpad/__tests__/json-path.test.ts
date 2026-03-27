/**
 * Tests for json-path.ts — JSON path parsing and manipulation helpers.
 */

import { parsePath, getByPath, setByPath, deleteByPath } from '../json-path.js';

describe('parsePath', () => {
  it('parses $.foo.bar into string segments', () => {
    expect(parsePath('$.foo.bar')).toEqual(['foo', 'bar']);
  });

  it('parses $.items[0] into mixed segments', () => {
    expect(parsePath('$.items[0]')).toEqual(['items', 0]);
  });

  it('returns empty array for bare $', () => {
    expect(parsePath('$')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parsePath('')).toEqual([]);
  });

  it('parses deeply nested path with mixed access', () => {
    expect(parsePath('$.a[1].b[2].c')).toEqual(['a', 1, 'b', 2, 'c']);
  });

  it('parses path without $ prefix', () => {
    expect(parsePath('foo.bar')).toEqual(['foo', 'bar']);
  });

  it('distinguishes numeric strings from indices', () => {
    // "01" is not a pure integer representation so stays as string
    expect(parsePath('$.items[01]')).toEqual(['items', '01']);
  });
});

describe('getByPath', () => {
  const obj = {
    name: 'test',
    nested: { deep: { value: 42 } },
    items: ['a', 'b', 'c'],
    matrix: [[1, 2], [3, 4]],
  };

  it('gets a top-level key', () => {
    expect(getByPath(obj, '$.name')).toBe('test');
  });

  it('gets a nested value', () => {
    expect(getByPath(obj, '$.nested.deep.value')).toBe(42);
  });

  it('gets an array element by index', () => {
    expect(getByPath(obj, '$.items[1]')).toBe('b');
  });

  it('gets nested array element', () => {
    expect(getByPath(obj, '$.matrix[0][1]')).toBe(2);
  });

  it('returns undefined for missing key', () => {
    expect(getByPath(obj, '$.missing')).toBeUndefined();
  });

  it('returns the root object for bare $', () => {
    expect(getByPath(obj, '$')).toBe(obj);
  });

  it('throws on non-object traversal', () => {
    expect(() => getByPath(obj, '$.name.child')).toThrow('cannot traverse into string');
  });

  it('throws when traversing through null', () => {
    const o = { a: null };
    expect(() => getByPath(o, '$.a.b')).toThrow('cannot traverse');
  });
});

describe('setByPath', () => {
  it('sets a top-level key', () => {
    const obj: Record<string, unknown> = { a: 1 };
    setByPath(obj, '$.b', 2);
    expect(obj.b).toBe(2);
  });

  it('sets a nested value', () => {
    const obj = { nested: { deep: { value: 0 } } };
    setByPath(obj, '$.nested.deep.value', 99);
    expect(obj.nested.deep.value).toBe(99);
  });

  it('sets an array element', () => {
    const obj = { items: ['a', 'b', 'c'] };
    setByPath(obj, '$.items[1]', 'B');
    expect(obj.items[1]).toBe('B');
  });

  it('creates a new key on existing object', () => {
    const obj = { existing: {} as Record<string, unknown> };
    setByPath(obj, '$.existing.newKey', 'hello');
    expect(obj.existing.newKey).toBe('hello');
  });

  it('throws on root path', () => {
    expect(() => setByPath({}, '$', 'nope')).toThrow('Cannot set at root path');
  });

  it('throws when traversing through non-object', () => {
    const obj = { a: 'string' };
    expect(() => setByPath(obj, '$.a.b', 1)).toThrow('parent is not an object');
  });
});

describe('deleteByPath', () => {
  it('deletes an object key', () => {
    const obj = { a: 1, b: 2 } as Record<string, unknown>;
    deleteByPath(obj, '$.b');
    expect(obj).toEqual({ a: 1 });
    expect('b' in obj).toBe(false);
  });

  it('deletes an array element by index (splice)', () => {
    const obj = { items: [10, 20, 30] };
    deleteByPath(obj, '$.items[1]');
    expect(obj.items).toEqual([10, 30]);
  });

  it('deletes a nested key', () => {
    const obj = { nested: { x: 1, y: 2 } as Record<string, unknown> };
    deleteByPath(obj, '$.nested.x');
    expect(obj.nested).toEqual({ y: 2 });
  });

  it('throws on root path', () => {
    expect(() => deleteByPath({}, '$')).toThrow('Cannot delete root');
  });

  it('throws when traversing through non-object', () => {
    const obj = { a: 42 };
    expect(() => deleteByPath(obj, '$.a.b')).toThrow('parent is not an object');
  });

  it('deletes first array element', () => {
    const obj = { items: ['x', 'y', 'z'] };
    deleteByPath(obj, '$.items[0]');
    expect(obj.items).toEqual(['y', 'z']);
  });
});
