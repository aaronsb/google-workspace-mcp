/**
 * Types for the build-time coverage analysis tool (ADR-100).
 */

/** Services eligible for the factory model. */
export const ELIGIBLE_SERVICES = [
  'drive', 'sheets', 'gmail', 'calendar', 'docs',
  'slides', 'tasks', 'people', 'chat', 'keep', 'meet', 'events',
] as const;

/** Internal/path params to skip when comparing parameters. */
export const SKIP_PARAMS = new Set([
  'userId', 'key', 'oauth_token', 'prettyPrint', 'quotaUser', 'alt',
  'uploadType', 'upload_protocol', 'fields', 'callback', 'access_token',
]);

export interface DiscoveredParam {
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  deprecated?: boolean;
}

export interface DiscoveredOperation {
  resourcePath: string;
  description: string;
  httpMethod?: string;
  params: Record<string, DiscoveredParam>;
}

export interface DiscoveredHelper {
  name: string;
  description: string;
}

export interface DiscoveredService {
  operations: Record<string, DiscoveredOperation>;
  helpers: Record<string, DiscoveredHelper>;
}

export interface DiscoveredSurface {
  apiSurface: string;
  services: Record<string, DiscoveredService>;
}

export type BaselineStatus = 'covered' | 'gap' | 'excluded';

export interface BaselineEntry {
  status: BaselineStatus;
  reason?: string;
  params?: Record<string, 'covered' | 'gap'>;
}

export interface CoverageBaseline {
  apiSurface: string;
  generatedAt: string;
  services: Record<string, {
    operations: Record<string, BaselineEntry>;
  }>;
}

export interface ParamGap {
  paramName: string;
  inGoogle: boolean;
  inManifest: boolean;
  details?: string;
}

export interface ServiceCoverage {
  service: string;
  totalOps: number;
  coveredOps: number;
  excludedOps: number;
  gapOps: number;
  newOps: string[];
  removedOps: string[];
  paramGaps: Record<string, ParamGap[]>;
  /**
   * The Google methods this service's manifest actually covers.
   *
   * This exists because the baseline used to INFER coverage from `paramGaps` — an
   * operation was recorded as covered only if it had a parameter gap. An operation
   * covered *perfectly*, with every parameter mapped, therefore had no gap entry, fell
   * through, and was written to the baseline as `status: "gap"`. The baseline called an
   * operation uncovered BECAUSE it was flawlessly covered, and 25 of them were committed
   * as uncovered work for contributors to pick up.
   *
   * `coveredOps` (the count) was right the whole time; only the persisted list was wrong,
   * so the printed report and the committed artifact disagreed and nothing compared them.
   * Coverage is now carried explicitly, from the manifest, and asserted against the count.
   */
  coveredPaths: string[];
}

export interface CoverageReport {
  apiSurface: string;
  timestamp: string;
  totalOps: number;
  coveredOps: number;
  coveragePercent: number;
  services: ServiceCoverage[];
}
