/**
 * Baseline file management for coverage tracking.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoverageBaseline, CoverageReport, BaselineEntry } from './types.js';

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

/** Generate a new baseline from a coverage report, preserving exclusions from existing baseline. */
export function generateBaseline(
  report: CoverageReport,
  existing?: CoverageBaseline | null,
): CoverageBaseline {
  const services: CoverageBaseline['services'] = {};

  for (const svc of report.services) {
    const existingOps = existing?.services[svc.service]?.operations || {};
    const operations: Record<string, BaselineEntry> = {};

    // Walk the report to build new entries
    // We need the discovered surface to know all operations — pull from existing + report
    // Covered operations
    for (const [opPath, gaps] of Object.entries(svc.paramGaps)) {
      operations[opPath] = {
        status: 'covered',
        params: Object.fromEntries(
          gaps.map(g => [g.paramName, g.inManifest ? 'covered' : 'gap'] as const),
        ),
      };
    }

    // For covered ops without param gaps, just mark as covered
    // We infer these from the report structure — any op that's covered is in coveredOps count
    // The comparison module handles classification; we just preserve exclusions here

    // Preserve excluded entries from existing baseline
    for (const [opPath, entry] of Object.entries(existingOps)) {
      if (entry.status === 'excluded') {
        operations[opPath] = entry;
      }
    }

    // Mark new gaps
    for (const opPath of svc.newOps) {
      if (!operations[opPath]) {
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
