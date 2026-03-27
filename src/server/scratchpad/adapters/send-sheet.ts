/**
 * Send adapter: sheet_write — writes scratchpad CSV content to a Google Sheet.
 * Parses CSV lines back into a values array for spreadsheets.values.update.
 */

import { execute } from '../../../executor/gws.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface SheetWriteParams {
  email: string;
  spreadsheetId: string;
  range?: string;
}

export async function sendSheetWrite(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: SheetWriteParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, spreadsheetId, range = 'Sheet1' } = targetParams;
  if (!email || !spreadsheetId) {
    return {
      text: `Send failed: email and spreadsheetId are required for sheet_write.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  // Parse CSV lines into values array
  const lines = content.split('\n').filter(l => l.trim());
  const values = lines.map(parseCsvLine);

  try {
    await execute([
      'sheets', 'spreadsheets', 'values', 'update',
      '--params', JSON.stringify({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      }),
    ], { account: email });

    return {
      text: `Written ${values.length} rows to sheet ${spreadsheetId} (${range}).`,
      refs: { scratchpadId, spreadsheetId, range, rows: values.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}

/** Parse a CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
