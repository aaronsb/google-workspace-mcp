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
  gwsVersion: string;
  services: Record<string, DiscoveredService>;
}

export type BaselineStatus = 'covered' | 'gap' | 'excluded';

export interface BaselineEntry {
  status: BaselineStatus;
  reason?: string;
  params?: Record<string, 'covered' | 'gap'>;
}

export interface CoverageBaseline {
  gwsVersion: string;
  generatedAt: string;
  services: Record<string, {
    operations: Record<string, BaselineEntry>;
  }>;
}

export interface ParamGap {
  paramName: string;
  inGws: boolean;
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
}

export interface CoverageReport {
  gwsVersion: string;
  timestamp: string;
  totalOps: number;
  coveredOps: number;
  coveragePercent: number;
  services: ServiceCoverage[];
}
