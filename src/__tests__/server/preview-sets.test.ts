/**
 * The store of previewed sets (ADR-310): bounded by size, age and count, keyed by token,
 * scoped to the account.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { PREVIEW_TTL_MS } from '../../server/preview-gate.js';
import {
  MAX_PENDING_SETS,
  MAX_SET_SIZE,
  clearHeldSets,
  heldSet,
  heldSetCount,
  holdSet,
  releaseSet,
  setDigest,
} from '../../server/preview-sets.js';

const T0 = 1_800_000_000_000;
afterEach(() => clearHeldSets());

describe('a held set', () => {
  it('comes back for its token and account, and only those', () => {
    holdSet('tok', 'Me@Test.com', ['a', 'b'], T0);
    expect(heldSet('tok', 'me@test.com', T0)).toEqual(['a', 'b']);
    expect(heldSet('tok', 'other@test.com', T0)).toBeUndefined();
    expect(heldSet('other-token', 'me@test.com', T0)).toBeUndefined();
  });

  it('is a copy, so a caller cannot alter what is held', () => {
    const ids = ['a', 'b'];
    holdSet('tok', 'me@test.com', ids, T0);
    ids.push('c');
    heldSet('tok', 'me@test.com', T0)!.push('d');
    expect(heldSet('tok', 'me@test.com', T0)).toEqual(['a', 'b']);
  });

  it('is gone once released', () => {
    holdSet('tok', 'me@test.com', ['a'], T0);
    releaseSet('tok');
    expect(heldSet('tok', 'me@test.com', T0)).toBeUndefined();
  });

  it('expires with its token', () => {
    holdSet('tok', 'me@test.com', ['a'], T0);
    expect(heldSet('tok', 'me@test.com', T0 + PREVIEW_TTL_MS)).toEqual(['a']);
    expect(heldSet('tok', 'me@test.com', T0 + PREVIEW_TTL_MS + 1)).toBeUndefined();
  });
});

describe('the bounds', () => {
  it('refuses a set over the size cap', () => {
    expect(() => holdSet('tok', 'me@test.com', Array.from({ length: MAX_SET_SIZE + 1 }, (_, i) => `m${i}`), T0))
      .toThrow(/at most 10000/);
    expect(() => holdSet('tok', 'me@test.com', Array.from({ length: MAX_SET_SIZE }, (_, i) => `m${i}`), T0)).not.toThrow();
  });

  it('displaces the oldest preview past the count cap', () => {
    for (let i = 0; i <= MAX_PENDING_SETS; i++) holdSet(`tok${i}`, 'me@test.com', [`m${i}`], T0 + i);
    expect(heldSetCount(T0 + MAX_PENDING_SETS)).toBe(MAX_PENDING_SETS);
    expect(heldSet('tok0', 'me@test.com', T0 + MAX_PENDING_SETS)).toBeUndefined();
    expect(heldSet(`tok${MAX_PENDING_SETS}`, 'me@test.com', T0 + MAX_PENDING_SETS)).toEqual([`m${MAX_PENDING_SETS}`]);
  });
});

describe('setDigest', () => {
  it('ignores order and sees any difference in membership', () => {
    expect(setDigest(['b', 'a'])).toBe(setDigest(['a', 'b']));
    expect(setDigest(['a', 'b'])).not.toBe(setDigest(['a', 'c']));
    expect(setDigest(['a', 'b'])).not.toBe(setDigest(['a']));
  });
});
