/**
 * Baseline file management for coverage tracking.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoverageBaseline, CoverageReport, BaselineEntry, DiscoveredSurface } from './types.js';

const DEFAULT_PATH = 'coverage-baseline.json';

function resolvePath(filePath?: string): string {
  const p = filePath || DEFAULT_PATH;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export function loadBaseline(filePath?: string): CoverageBaseline | null {
  const resolved = resolvePath(filePath);
  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    return JSON.parse(raw) as CoverageBaseline;
  } catch {
    return null;
  }
}

/**
 * Build the set of manifest-covered resource paths.
 *
 * This used to read `svc.paramGaps` — "ops with param gaps are covered" — which is a
 * PROXY for coverage, and a backwards one. An operation with every parameter mapped has
 * no param gaps, so it was absent here, fell through the checks below, and got written
 * as `status: "gap"`. Coverage this good was indistinguishable from no coverage at all.
 * 25 fully-covered operations were committed to coverage-baseline.json as uncovered
 * work, including `docs:documents.create`, which takes no parameters and so could never
 * have had a gap.
 *
 * Now it reads what the report actually measured, from the manifest. Same source the
 * printed count uses — which is why the count was right while the artifact was wrong.
 */
function getCoveredPaths(report: CoverageReport): Set<string> {
  const covered = new Set<string>();
  for (const svc of report.services) {
    for (const opPath of svc.coveredPaths) {
      covered.add(`${svc.service}:${opPath}`);
    }
  }
  return covered;
}

/** Generate a new baseline from a coverage report + discovered surface. */
export function generateBaseline(
  report: CoverageReport,
  discovered: DiscoveredSurface,
  existing?: CoverageBaseline | null,
): CoverageBaseline {
  const services: CoverageBaseline['services'] = {};

  const coveredPaths = getCoveredPaths(report);

  for (const svc of report.services) {
    const disc = discovered.services[svc.service];
    if (!disc) continue;

    const existingOps = existing?.services[svc.service]?.operations || {};
    const operations: Record<string, BaselineEntry> = {};

    // Enumerate all discovered operations
    const allPaths = new Set<string>([
      ...Object.keys(disc.operations),
      ...Object.keys(disc.helpers),
    ]);

    for (const opPath of allPaths) {
      // Check if excluded in existing baseline — preserve
      if (existingOps[opPath]?.status === 'excluded') {
        operations[opPath] = existingOps[opPath];
        continue;
      }

      // Covered is covered — asked directly, not inferred from a side effect.
      // A fully-mapped operation has no param gaps, and that is a sign of GOOD coverage,
      // not missing coverage. `params` stays undefined when there is nothing to flag.
      if (coveredPaths.has(`${svc.service}:${opPath}`)) {
        const gaps = svc.paramGaps[opPath] || [];
        operations[opPath] = {
          status: 'covered',
          params: gaps.length > 0
            ? Object.fromEntries(gaps.map(g => [g.paramName, g.inManifest ? 'covered' : 'gap'] as const))
            : undefined,
        };
        continue;
      }

      operations[opPath] = { status: 'gap' };
    }

    services[svc.service] = { operations };
  }

  // The artifact must agree with the report it came from.
  //
  // This is the check whose absence let the bug live: `make coverage` PRINTED 60/233
  // while the file it wrote recorded 35, and nothing ever compared the two. A baseline
  // that silently contradicts its own report is worse than no baseline — it hands
  // contributors a list of "gaps" that are already implemented.
  const persisted = Object.values(services)
    .flatMap(s => Object.values(s.operations))
    .filter(op => op.status === 'covered').length;
  const reported = report.services.reduce((n, s) => n + s.coveredOps, 0);
  if (persisted !== reported) {
    throw new Error(
      `coverage baseline disagrees with the report it was generated from: ` +
      `the report counts ${reported} covered operations, the baseline recorded ${persisted}. ` +
      `Refusing to write an artifact that contradicts its own measurement.`,
    );
  }

  return {
    apiSurface: report.apiSurface,
    generatedAt: report.timestamp,
    services,
  };
}

export function writeBaseline(baseline: CoverageBaseline, filePath?: string): string {
  const resolved = resolvePath(filePath);
  fs.writeFileSync(resolved, JSON.stringify(baseline, null, 2) + '\n');
  return resolved;
}
