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

/** Build the set of manifest-covered resource/helper paths. */
function getCoveredPaths(report: CoverageReport): Set<string> {
  const covered = new Set<string>();
  for (const svc of report.services) {
    // Ops with param gaps are covered
    for (const opPath of Object.keys(svc.paramGaps)) {
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

  // Build a lookup of covered paths from the report's param gaps
  // (ops with param gaps are definitely covered)
  const paramGapPaths = getCoveredPaths(report);

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

      // Check if covered (has param gaps recorded)
      const key = `${svc.service}:${opPath}`;
      if (paramGapPaths.has(key)) {
        const gaps = svc.paramGaps[opPath] || [];
        operations[opPath] = {
          status: 'covered',
          params: gaps.length > 0
            ? Object.fromEntries(gaps.map(g => [g.paramName, g.inManifest ? 'covered' : 'gap'] as const))
            : undefined,
        };
        continue;
      }

      // Check if it's covered but without param gaps — need to check the report counts
      // We can infer from whether the op was NOT in newOps and NOT excluded
      const isNew = svc.newOps.includes(opPath);
      const wasCovered = existingOps[opPath]?.status === 'covered';

      if (wasCovered && !isNew) {
        operations[opPath] = { status: 'covered' };
      } else {
        operations[opPath] = { status: 'gap' };
      }
    }

    services[svc.service] = { operations };
  }

  return {
    gwsVersion: report.gwsVersion,
    generatedAt: report.timestamp,
    services,
  };
}

export function writeBaseline(baseline: CoverageBaseline, filePath?: string): string {
  const resolved = resolvePath(filePath);
  fs.writeFileSync(resolved, JSON.stringify(baseline, null, 2) + '\n');
  return resolved;
}
