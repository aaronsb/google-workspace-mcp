#!/usr/bin/env node
/**
 * Build-time coverage analysis tool (ADR-100).
 *
 * Compares the curated manifest against the gws CLI's actual surface
 * to produce a structured coverage report.
 *
 * Usage:
 *   node build/coverage/analyze.js           # print coverage report
 *   node build/coverage/analyze.js --update   # also update baseline file
 *   node build/coverage/analyze.js --json     # output as JSON
 */

import { loadManifest } from '../factory/generator.js';
import { discoverSurface } from './discover.js';
import { compareSurfaces } from './compare.js';
import { loadBaseline, generateBaseline, writeBaseline } from './baseline.js';
import { formatTerminalReport, formatJsonReport } from './report.js';

const args = process.argv.slice(2);
const doUpdate = args.includes('--update');
const jsonOutput = args.includes('--json');

async function main(): Promise<void> {
  // Load curated manifest (same parser the server uses)
  const manifest = loadManifest();

  // Load existing baseline (if any)
  const baseline = loadBaseline();

  // Discover the gws CLI surface
  process.stderr.write('[coverage] Discovering gws CLI surface...\n');
  const discovered = discoverSurface();

  // Compare
  const report = compareSurfaces(manifest, discovered, baseline);

  // Output
  if (jsonOutput) {
    process.stdout.write(formatJsonReport(report) + '\n');
  } else {
    process.stdout.write(formatTerminalReport(report));
  }

  // Update baseline if requested
  if (doUpdate) {
    const newBaseline = generateBaseline(report, baseline);
    const path = writeBaseline(newBaseline);
    process.stderr.write(`[coverage] Baseline updated: ${path}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[coverage] Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
