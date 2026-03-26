/**
 * Import adapter: sheet — loads a Google Sheet as CSV lines into a scratchpad.
 */

import { execute } from '../../../executor/gws.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface SheetImportParams {
  email: string;
  spreadsheetId: string;
  range?: string;
}

export async function importSheet(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: SheetImportParams,
): Promise<HandlerResponse> {
  const { email, spreadsheetId, range } = sourceParams;
  if (!email || !spreadsheetId) {
    return { text: 'email and spreadsheetId are required for sheet import.', refs: { error: true } };
  }

  try {
    const params: Record<string, unknown> = { spreadsheetId };
    if (range) params.range = range;

    // Default to first sheet if no range specified
    const rangeArg = range ?? 'Sheet1';

    const result = await execute([
      'sheets', 'spreadsheets', 'values', 'get',
      '--params', JSON.stringify({ spreadsheetId, range: rangeArg }),
    ], { account: email });

    const data = result.data as Record<string, unknown>;
    const values = (data.values ?? []) as string[][];

    if (values.length === 0) {
      return {
        text: `Sheet ${spreadsheetId} (${rangeArg}) has no data.\nScratchpad ${scratchpadId} unchanged.`,
        refs: { scratchpadId, spreadsheetId },
      };
    }

    // Convert to CSV lines
    const csvLines = values.map(row => row.map(escapeCsvField).join(','));

    scratchpads.appendRawLines(scratchpadId, csvLines);
    scratchpads.setFormat(scratchpadId, 'csv');

    return {
      text: `Imported sheet as CSV (${csvLines.length} rows) into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, spreadsheetId, range: rangeArg, rowsImported: csvLines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}

/** Escape a CSV field: quote if it contains comma, newline, or double-quote. */
function escapeCsvField(field: string): string {
  if (field === undefined || field === null) return '';
  const s = String(field);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
