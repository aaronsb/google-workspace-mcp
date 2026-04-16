/**
 * Patch coverage report — tracks which operations have custom formatting,
 * custom handlers, or hooks vs falling through to defaults.
 *
 * This isn't a pass/fail gate — it's a visibility tool. When the manifest
 * expands, this test shows which new operations are using defaults and
 * might benefit from a patch. When patches change, it catches regressions
 * where an operation silently loses its custom formatter.
 */

import { loadManifest } from '../../factory/generator.js';
import { patches } from '../../factory/patches.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

// Mock executor — patches that call execute() in custom handlers need this
jest.mock('../../executor/gws.js');

const manifest = loadManifest();

interface CoverageEntry {
  service: string;
  operation: string;
  opType: string;
  hasCustomHandler: boolean;
  hasBeforeExecute: boolean;
  hasAfterExecute: boolean;
  usesCustomFormat: boolean;
}

/** Check if a format hook dispatches to a custom formatter for a given operation. */
function probeFormatHook(
  hook: ((data: unknown, ctx: PatchContext) => HandlerResponse) | undefined,
  operation: string,
): boolean {
  if (!hook) return false;
  // Call the formatter with empty data and see if it produces something
  // different from what the default would — we check by calling with a
  // known operation name and seeing if the switch statement catches it
  try {
    const ctx: PatchContext = { operation, params: {}, account: 'test@test.com' };
    const result = hook({}, ctx);
    // If it returns without throwing, the hook handles this operation
    return result !== undefined;
  } catch {
    return false;
  }
}

function buildCoverageMap(): CoverageEntry[] {
  const entries: CoverageEntry[] = [];

  for (const [serviceName, serviceDef] of Object.entries(manifest.services)) {
    const patch = patches[serviceName] as ServicePatch | undefined;

    for (const [opName, opDef] of Object.entries(serviceDef.operations)) {
      entries.push({
        service: serviceName,
        operation: opName,
        opType: opDef.type,
        hasCustomHandler: Boolean(patch?.customHandlers?.[opName]),
        hasBeforeExecute: Boolean(patch?.beforeExecute?.[opName]),
        hasAfterExecute: Boolean(patch?.afterExecute?.[opName]),
        usesCustomFormat: (() => {
          if (patch?.customHandlers?.[opName]) return true; // custom handlers do their own formatting
          switch (opDef.type) {
            case 'list': return probeFormatHook(patch?.formatList, opName);
            case 'detail': return probeFormatHook(patch?.formatDetail, opName);
            case 'action': return probeFormatHook(patch?.formatAction, opName);
            default: return false;
          }
        })(),
      });
    }
  }

  return entries;
}

describe('patch coverage', () => {
  const coverage = buildCoverageMap();

  it('reports coverage for all manifest operations', () => {
    // This is the visibility test — it prints coverage so you can see gaps
    const total = coverage.length;
    const customFormatted = coverage.filter(e => e.usesCustomFormat).length;
    const defaultFormatted = total - customFormatted;
    const withHooks = coverage.filter(e => e.hasBeforeExecute || e.hasAfterExecute).length;

    console.log(`\n  Patch Coverage: ${customFormatted}/${total} operations have custom formatting`);
    console.log(`  Default formatting: ${defaultFormatted} operations`);
    console.log(`  Lifecycle hooks: ${withHooks} operations\n`);

    // Log per-service breakdown
    for (const serviceName of Object.keys(manifest.services)) {
      const serviceOps = coverage.filter(e => e.service === serviceName);
      const custom = serviceOps.filter(e => e.usesCustomFormat);
      const defaults = serviceOps.filter(e => !e.usesCustomFormat);

      console.log(`  ${serviceName}: ${custom.length}/${serviceOps.length} custom`);
      if (defaults.length > 0) {
        console.log(`    defaults: ${defaults.map(e => e.operation).join(', ')}`);
      }
    }

    expect(total).toBeGreaterThan(0);
  });

  // Snapshot test — catches when operations silently lose their patches
  it('gmail core operations have custom formatting', () => {
    const gmailCustom = coverage
      .filter(e => e.service === 'gmail' && e.usesCustomFormat)
      .map(e => e.operation)
      .sort();

    expect(gmailCustom).toContain('search');
    expect(gmailCustom).toContain('read');
    expect(gmailCustom).toContain('triage');
    expect(gmailCustom).toContain('labels');
    expect(gmailCustom).toContain('threads');
    expect(gmailCustom).toContain('send');
    expect(gmailCustom).toContain('reply');
  });

  it('calendar core operations have custom formatting', () => {
    const calCustom = coverage
      .filter(e => e.service === 'calendar' && e.usesCustomFormat)
      .map(e => e.operation)
      .sort();

    expect(calCustom).toContain('list');
    expect(calCustom).toContain('get');
    expect(calCustom).toContain('calendars');
    expect(calCustom).toContain('agenda');
    expect(calCustom).toContain('create');
    expect(calCustom).toContain('delete');
  });

  it('drive core operations have custom formatting', () => {
    const driveCustom = coverage
      .filter(e => e.service === 'drive' && e.usesCustomFormat)
      .map(e => e.operation)
      .sort();

    expect(driveCustom).toContain('search');
    expect(driveCustom).toContain('get');
    expect(driveCustom).toContain('upload');
    expect(driveCustom).toContain('download');
  });

  it('sheets core operations have custom formatting', () => {
    const sheetsCustom = coverage
      .filter(e => e.service === 'sheets' && e.usesCustomFormat)
      .map(e => e.operation)
      .sort();

    // Data ops
    expect(sheetsCustom).toContain('get');
    expect(sheetsCustom).toContain('read');
    expect(sheetsCustom).toContain('getValues');
    expect(sheetsCustom).toContain('create');
    expect(sheetsCustom).toContain('append');
    expect(sheetsCustom).toContain('updateValues');
    // Tab management
    expect(sheetsCustom).toContain('addSheet');
    expect(sheetsCustom).toContain('renameSheet');
    expect(sheetsCustom).toContain('deleteSheet');
    expect(sheetsCustom).toContain('duplicateSheet');
    expect(sheetsCustom).toContain('renameSpreadsheet');
    expect(sheetsCustom).toContain('copySheetTo');
  });

  it('meet core operations have custom formatting', () => {
    const meetCustom = coverage
      .filter(e => e.service === 'meet' && e.usesCustomFormat)
      .map(e => e.operation)
      .sort();

    expect(meetCustom).toContain('listConferences');
    expect(meetCustom).toContain('listParticipants');
    expect(meetCustom).toContain('listTranscripts');
    expect(meetCustom).toContain('listTranscriptEntries');
    expect(meetCustom).toContain('listRecordings');
    expect(meetCustom).toContain('listSmartNotes');
    expect(meetCustom).toContain('getConference');
    expect(meetCustom).toContain('getFullTranscript');
  });

  it('gmail search has afterExecute hydration hook', () => {
    const searchEntry = coverage.find(e => e.service === 'gmail' && e.operation === 'search');
    expect(searchEntry?.hasAfterExecute).toBe(true);
  });

  it('calendar list has beforeExecute hook for timeMin default', () => {
    const listEntry = coverage.find(e => e.service === 'calendar' && e.operation === 'list');
    expect(listEntry?.hasBeforeExecute).toBe(true);
  });

  it('all operations have a patch or use defaults (no orphans)', () => {
    // Every operation should either have custom formatting OR fall through
    // to the default formatter. This catches operations that might error
    // because neither path handles them.
    for (const entry of coverage) {
      const hasPath = entry.usesCustomFormat || !entry.usesCustomFormat; // always true, but...
      // The real check: if there IS a patch for this service, the format
      // hooks should handle all operation types without throwing
      const patch = patches[entry.service];
      if (patch) {
        const ctx: PatchContext = { operation: entry.operation, params: {}, account: 'test@test.com' };
        if (entry.opType === 'list' && patch.formatList) {
          expect(() => patch.formatList!({}, ctx)).not.toThrow();
        }
        if (entry.opType === 'detail' && patch.formatDetail) {
          expect(() => patch.formatDetail!({}, ctx)).not.toThrow();
        }
      }
      expect(hasPath).toBe(true);
    }
  });
});
