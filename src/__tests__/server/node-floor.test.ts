/**
 * Tests for the Node floor comparison.
 *
 * This file exists because its absence let a real regression through: a revert of the
 * pre-release fix below passed `make check`, all 681 tests, and every CI job, because
 * nothing anywhere exercised the comparison. `check-node-floor.mjs` asserts MIN_NODE has
 * the right VALUE and that the entrypoint imports the server dynamically — neither says
 * anything about whether the arithmetic is right.
 */
import { describe, it, expect } from 'vitest';
import { meets, MIN_NODE, floorMessage } from '../../node-floor.js';

describe('meets', () => {
  const FLOOR = '22.12.0';

  it('accepts the floor exactly', () => {
    expect(meets('22.12.0', FLOOR)).toBe(true);
  });

  it.each([
    ['22.12.1', 'patch above'],
    ['22.13.0', 'minor above'],
    ['24.0.0', 'major above'],
    ['26.4.0', 'well above'],
  ])('accepts %s (%s)', (version) => {
    expect(meets(version, FLOOR)).toBe(true);
  });

  it.each([
    ['22.11.0', 'minor below'],
    ['22.0.0', 'same major, minor below'],
    ['21.99.99', 'major below'],
    ['20.19.0', 'the old floor'],
    ['18.14.1', 'the floor before that'],
  ])('rejects %s (%s)', (version) => {
    expect(meets(version, FLOOR)).toBe(false);
  });

  // The regression the review caught: '-rc.1' landed in the patch slot, parseInt('0-rc')
  // was 0, and the release candidate compared EQUAL to the floor — waved through, in the
  // dangerous direction. A pre-release of the floor may predate the require(ESM) backport
  // the floor exists to guarantee.
  describe('pre-releases sort BELOW their release (semver §11.3)', () => {
    it.each([
      '22.12.0-rc.1',
      '22.12.0-pre',
      '22.12.0-nightly20260101',
    ])('rejects %s — a pre-release of the floor is below the floor', (version) => {
      expect(meets(version, FLOOR)).toBe(false);
    });

    it.each([
      '23.0.0-rc.1',
      '22.13.0-pre',
    ])('accepts %s — a pre-release of a HIGHER version still clears the floor', (version) => {
      expect(meets(version, FLOOR)).toBe(true);
    });
  });

  it('tolerates a leading v', () => {
    expect(meets('v24.0.0', FLOOR)).toBe(true);
    expect(meets('v20.0.0', FLOOR)).toBe(false);
  });

  it('treats a missing component as zero', () => {
    expect(meets('22', FLOOR)).toBe(false);      // 22.0.0 < 22.12.0
    expect(meets('22.12', FLOOR)).toBe(true);    // 22.12.0 == floor
    expect(meets('23', FLOOR)).toBe(true);
  });

  it('does not wave through a version it cannot parse', () => {
    // Unparseable components degrade to 0 — i.e. toward "older", never toward "newer".
    expect(meets('not-a-version', FLOOR)).toBe(false);
    expect(meets('', FLOOR)).toBe(false);
  });
});

describe('MIN_NODE', () => {
  it('is an exact three-part version', () => {
    // check-node-floor.mjs compares this against engines.node, the CI job and the mcpb
    // manifest by exact string match; a range or a two-part version breaks that coupling.
    expect(MIN_NODE).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is at least 22.12.0 — the unflagged require(ESM) threshold', () => {
    // Below this, sanitize-html (CommonJS) cannot require() the pure-ESM htmlparser2@12
    // and the server crashes at startup. Lowering MIN_NODE without lowering that
    // dependency is the exact bug this floor exists to prevent.
    expect(meets(MIN_NODE, '22.12.0')).toBe(true);
  });
});

describe('floorMessage', () => {
  it('names both the required and the actual version', () => {
    const msg = floorMessage('v20.19.0');
    expect(msg).toContain(`requires Node >=${MIN_NODE}`);
    expect(msg).toContain('v20.19.0');
  });

  it('tells .mcpb users to upgrade the app, not the server', () => {
    // The bundle runs the HOST's node; upgrading this package cannot help them.
    expect(floorMessage('v20.19.0')).toContain('upgrade the app');
  });
});
