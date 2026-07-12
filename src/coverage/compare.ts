/**
 * Compare the curated manifest against the API surface Google publishes.
 */

import type { Manifest } from '../factory/types.js';
import type {
  DiscoveredSurface, CoverageBaseline, CoverageReport,
  ServiceCoverage, ParamGap, DiscoveredParam,
} from './types.js';
import { ELIGIBLE_SERVICES, SKIP_PARAMS } from './types.js';

/**
 * Build the set of Google methods the manifest covers.
 *
 * There is no `opDef.helper` any more. gws's `+helpers` are gone: nine of them
 * were plain Google methods in a CLI costume, and the two that actually reshaped
 * anything are now built from raw Google in our own layer (ADR-103). An operation
 * either names a Google method or is a custom handler composed of them.
 */
function buildCoveredPaths(manifest: Manifest): Map<string, { service: string; opName: string; params: Set<string> }> {
  const covered = new Map<string, { service: string; opName: string; params: Set<string> }>();

  for (const [_serviceName, serviceDef] of Object.entries(manifest.services)) {
    for (const [opName, opDef] of Object.entries(serviceDef.operations)) {
      const path = opDef.resource;
      if (!path) continue;

      const paramNames = new Set<string>();
      if (opDef.params) {
        for (const [name, paramDef] of Object.entries(opDef.params)) {
          // Use maps_to if declared, otherwise the param name itself
          paramNames.add(paramDef.maps_to || name);
        }
      }

      covered.set(path, {
        service: serviceDef.google_service,
        opName,
        params: paramNames,
      });
    }
  }

  return covered;
}

/** Compare params for a covered operation. */
function compareParams(
  manifestParams: Set<string>,
  googleParams: Record<string, DiscoveredParam>,
): ParamGap[] {
  const gaps: ParamGap[] = [];

  for (const [name, param] of Object.entries(googleParams)) {
    if (SKIP_PARAMS.has(name)) continue;
    if (param.deprecated) continue;

    if (!manifestParams.has(name)) {
      gaps.push({
        paramName: name,
        inGoogle: true,
        inManifest: false,
        details: `${param.type}${param.required ? ', required' : ''} — ${param.description.slice(0, 80)}`,
      });
    }
  }

  return gaps;
}

export function compareSurfaces(
  manifest: Manifest,
  discovered: DiscoveredSurface,
  baseline?: CoverageBaseline | null,
): CoverageReport {
  const coveredPaths = buildCoveredPaths(manifest);
  const serviceCoverages: ServiceCoverage[] = [];
  let totalOps = 0;
  let totalCovered = 0;

  for (const service of ELIGIBLE_SERVICES) {
    const disc = discovered.services[service];
    if (!disc) {
      // Eligible, but Google publishes no Discovery document for it
      continue;
    }

    const baselineOps = baseline?.services[service]?.operations || {};

    const allOps = new Set<string>();
    // Add resource-based operations
    for (const path of Object.keys(disc.operations)) {
      allOps.add(path);
    }
    // Add helpers
    for (const name of Object.keys(disc.helpers)) {
      allOps.add(name);
    }

    let covered = 0;
    let excluded = 0;
    let gap = 0;
    const newOps: string[] = [];
    const removedOps: string[] = [];
    const paramGaps: Record<string, ParamGap[]> = {};
    const coveredOpPaths: string[] = [];

    for (const opPath of allOps) {
      const isCovered = coveredPaths.has(opPath);
      const baselineEntry = baselineOps[opPath];
      const wasInBaseline = !!baselineEntry;

      if (isCovered) {
        covered++;
        coveredOpPaths.push(opPath);
        // Check param gaps for resource-based operations
        const discOp = disc.operations[opPath];
        const manifestEntry = coveredPaths.get(opPath);
        if (discOp && manifestEntry) {
          const gaps = compareParams(manifestEntry.params, discOp.params);
          if (gaps.length > 0) {
            paramGaps[opPath] = gaps;
          }
        }
      } else if (baselineEntry?.status === 'excluded') {
        excluded++;
      } else {
        gap++;
        if (!wasInBaseline) {
          newOps.push(opPath);
        }
      }
    }

    // In the baseline, but Google no longer publishes it
    for (const opPath of Object.keys(baselineOps)) {
      if (!allOps.has(opPath)) {
        removedOps.push(opPath);
      }
    }

    totalOps += allOps.size;
    totalCovered += covered;

    serviceCoverages.push({
      service,
      totalOps: allOps.size,
      coveredOps: covered,
      excludedOps: excluded,
      gapOps: gap,
      newOps,
      removedOps,
      paramGaps,
      coveredPaths: coveredOpPaths,
    });
  }

  return {
    apiSurface: discovered.apiSurface,
    timestamp: new Date().toISOString(),
    totalOps: totalOps,
    coveredOps: totalCovered,
    coveragePercent: totalOps > 0 ? Math.round((totalCovered / totalOps) * 100) : 0,
    services: serviceCoverages,
  };
}
