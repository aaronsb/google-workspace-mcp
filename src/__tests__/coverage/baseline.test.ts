/**
 * The coverage baseline must record what the report measured.
 *
 * There were no tests here at all, which is how this survived: `make coverage` PRINTED
 * 60/233 covered while the file it wrote recorded 35, and nothing compared the two.
 *
 * The cause was a proxy. `generateBaseline` decided an operation was covered by asking
 * whether it appeared in `paramGaps` — "ops with param gaps are covered". But an
 * operation whose parameters are ALL mapped has no param gaps. So the best-covered
 * operations were indistinguishable from uncovered ones and were written out as
 * `status: "gap"`. 25 of them were committed as uncovered work for contributors to pick
 * up, including `documents.create`, which takes no parameters and therefore could never
 * have had a gap to be "covered" by.
 *
 * The bug is not "a wrong number". It is a check that reported coverage while measuring
 * something else — so these tests assert on the two properties that were violated:
 * a perfectly-covered op is recorded covered, and the artifact agrees with its report.
 */
import { describe, expect, it } from 'vitest';

import { generateBaseline } from '../../coverage/baseline.js';
import type { CoverageReport, DiscoveredSurface, ServiceCoverage } from '../../coverage/types.js';

/** A service with two covered ops: one with a param gap, one perfectly covered. */
function surface(): DiscoveredSurface {
  return {
    apiSurface: 'google-discovery (docs/v1)',
    services: {
      docs: {
        helpers: {},
        operations: {
          // Takes no parameters at all — it can never have a param gap.
          'documents.create': {
            resourcePath: 'documents.create', description: '', httpMethod: 'POST', params: {},
          },
          // Has a parameter we do not map — this one DOES produce a gap.
          'documents.get': {
            resourcePath: 'documents.get', description: '', httpMethod: 'GET',
            params: { documentId: { type: 'string', description: '', required: true } },
          },
          // Not covered by the manifest at all.
          'documents.batchUpdate': {
            resourcePath: 'documents.batchUpdate', description: '', httpMethod: 'POST', params: {},
          },
        },
      },
    },
  };
}

function report(overrides: Partial<ServiceCoverage> = {}): CoverageReport {
  const svc: ServiceCoverage = {
    service: 'docs',
    totalOps: 3,
    coveredOps: 2,
    excludedOps: 0,
    gapOps: 1,
    newOps: [],
    removedOps: [],
    paramGaps: {
      'documents.get': [{ paramName: 'suggestionsViewMode', inGoogle: true, inManifest: false, details: '' }],
    },
    coveredPaths: ['documents.create', 'documents.get'],
    ...overrides,
  };
  return {
    apiSurface: 'google-discovery (docs/v1)',
    timestamp: '2026-07-12T00:00:00.000Z',
    totalOps: svc.totalOps,
    coveredOps: svc.coveredOps,
    coveragePercent: 67,
    services: [svc],
  };
}

describe('generateBaseline', () => {
  it('records a PERFECTLY covered operation as covered, not as a gap', () => {
    // The regression. `documents.create` is covered and has zero param gaps. Under the
    // old proxy it was absent from paramGaps, fell through, and was written as a "gap" —
    // marked uncovered *because* its coverage was complete.
    const baseline = generateBaseline(report(), surface());

    expect(baseline.services.docs.operations['documents.create'].status).toBe('covered');
    // …and with nothing to flag, it carries no param annotations.
    expect(baseline.services.docs.operations['documents.create'].params).toBeUndefined();
  });

  it('still records a covered operation that HAS a param gap, and flags the gap', () => {
    const baseline = generateBaseline(report(), surface());
    const op = baseline.services.docs.operations['documents.get'];

    expect(op.status).toBe('covered');
    expect(op.params).toEqual({ suggestionsViewMode: 'gap' });
  });

  it('records a genuinely uncovered operation as a gap', () => {
    const baseline = generateBaseline(report(), surface());
    expect(baseline.services.docs.operations['documents.batchUpdate'].status).toBe('gap');
  });

  it('REFUSES to write an artifact that contradicts the report it came from', () => {
    // The guard whose absence let the bug ship. Here the report says it measured 2
    // covered operations, but names only 1 — so persisting it would produce a baseline
    // that silently disagrees with the number `make coverage` prints.
    const inconsistent = report({ coveredPaths: ['documents.create'], coveredOps: 2 });

    expect(() => generateBaseline(inconsistent, surface()))
      .toThrow(/disagrees with the report .* counts 2 .* recorded 1/s);
  });

  it('preserves a deliberate exclusion across regeneration', () => {
    const existing = {
      apiSurface: 'x',
      generatedAt: '2026-01-01T00:00:00.000Z',
      services: {
        docs: {
          operations: {
            'documents.batchUpdate': { status: 'excluded' as const, reason: 'not useful to an agent' },
          },
        },
      },
    };
    // An exclusion is a human decision. Regenerating must not quietly downgrade it to a
    // gap and re-offer it as work.
    const baseline = generateBaseline(report(), surface(), existing);
    const op = baseline.services.docs.operations['documents.batchUpdate'];

    expect(op.status).toBe('excluded');
    expect(op.reason).toBe('not useful to an agent');
  });
});
