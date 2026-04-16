/**
 * Sheets patch — domain-specific hooks for the Sheets service.
 *
 * Key customizations:
 * - formatDetail for `get` (spreadsheet metadata + sheet tabs) and
 *   `read`/`getValues` (cell values rendered as a markdown table). The
 *   generic detail formatter drops object/array fields, so the `values`
 *   and `sheets` arrays are invisible without this patch.
 * - formatAction for `create` and `append` so the spreadsheetId / update
 *   summary make it back to the agent.
 * - customHandlers.updateValues — `spreadsheets.values.update` needs a
 *   request body containing `values`, which the manifest/factory path
 *   can't express. This handler accepts `values` (CSV for a single row)
 *   or `jsonValues` (JSON 2D array) and sends them via `--json`.
 */

import { execute } from '../../executor/gws.js';
import { requireString } from '../../server/handlers/validate.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

// --- Helpers ---

/** Escape a pipe so it doesn't break the markdown table. */
function escapeCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Render a 2D values array as a compact pipe-delimited markdown block. */
function renderValuesTable(values: unknown[][]): string {
  if (values.length === 0) return '_(empty range)_';
  const rows = values.map(row =>
    (row ?? []).map(escapeCell).join(' | '),
  );
  return rows.join('\n');
}

/** Parse a simple CSV line respecting quoted fields. */
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

// --- Detail formatters ---

function formatValuesDetail(data: unknown): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const range = String(raw.range ?? '');
  const majorDimension = String(raw.majorDimension ?? 'ROWS');
  const values = (raw.values as unknown[][]) ?? [];
  const rowCount = values.length;
  const colCount = rowCount > 0 ? Math.max(...values.map(r => (r ?? []).length)) : 0;

  const header = range ? `## ${range}` : '## Values';
  const meta = `**Rows:** ${rowCount} | **Columns:** ${colCount} | **Major dimension:** ${majorDimension}`;
  const table = renderValuesTable(values);

  return {
    text: `${header}\n\n${meta}\n\n${table}`,
    refs: { range, majorDimension, rowCount, colCount, values },
  };
}

function formatSpreadsheetDetail(data: unknown): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const spreadsheetId = String(raw.spreadsheetId ?? '');
  const spreadsheetUrl = String(raw.spreadsheetUrl ?? '');
  const props = (raw.properties ?? {}) as Record<string, unknown>;
  const title = String(props.title ?? 'Untitled');
  const locale = props.locale ? String(props.locale) : '';
  const timeZone = props.timeZone ? String(props.timeZone) : '';
  const sheets = ((raw.sheets ?? []) as Array<Record<string, unknown>>)
    .map(s => (s.properties ?? {}) as Record<string, unknown>);

  const parts: string[] = [`## ${title}`];
  parts.push(`**Spreadsheet ID:** ${spreadsheetId}`);
  if (spreadsheetUrl) parts.push(`**URL:** ${spreadsheetUrl}`);
  if (locale) parts.push(`**Locale:** ${locale}`);
  if (timeZone) parts.push(`**Time zone:** ${timeZone}`);

  if (sheets.length > 0) {
    parts.push('', `### Sheets (${sheets.length})`);
    for (const sp of sheets) {
      const name = String(sp.title ?? '');
      const sheetId = String(sp.sheetId ?? '');
      const gridProps = (sp.gridProperties ?? {}) as Record<string, unknown>;
      const rows = gridProps.rowCount ?? '?';
      const cols = gridProps.columnCount ?? '?';
      parts.push(`- **${name}** (sheetId: ${sheetId}) — ${rows} rows × ${cols} cols`);
    }
  }

  return {
    text: parts.join('\n'),
    refs: {
      spreadsheetId,
      spreadsheetUrl,
      title,
      sheets: sheets.map(sp => ({
        sheetId: sp.sheetId,
        title: sp.title,
        rowCount: (sp.gridProperties as Record<string, unknown>)?.rowCount,
        columnCount: (sp.gridProperties as Record<string, unknown>)?.columnCount,
      })),
    },
  };
}

// --- Action formatters ---

function formatCreateAction(data: unknown): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const spreadsheetId = String(raw.spreadsheetId ?? '');
  const spreadsheetUrl = String(raw.spreadsheetUrl ?? '');
  const title = String((raw.properties as Record<string, unknown>)?.title ?? 'Untitled');
  const sheets = ((raw.sheets ?? []) as Array<Record<string, unknown>>)
    .map(s => String((s.properties as Record<string, unknown>)?.title ?? ''));

  const parts = [`Spreadsheet created: **${title}**`, `\n**Spreadsheet ID:** ${spreadsheetId}`];
  if (spreadsheetUrl) parts.push(`\n**URL:** ${spreadsheetUrl}`);
  if (sheets.length > 0) parts.push(`\n**Sheets:** ${sheets.join(', ')}`);

  return {
    text: parts.join(''),
    refs: { spreadsheetId, spreadsheetUrl, title, sheets },
  };
}

function formatClearAction(data: unknown): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const spreadsheetId = String(raw.spreadsheetId ?? '');
  const clearedRange = String(raw.clearedRange ?? '');
  return {
    text: clearedRange
      ? `Range cleared.\n\n**Range:** ${clearedRange}`
      : 'Range cleared.',
    refs: { spreadsheetId, clearedRange },
  };
}

function formatAppendAction(data: unknown): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const spreadsheetId = String(raw.spreadsheetId ?? '');
  const updates = (raw.updates ?? {}) as Record<string, unknown>;
  const updatedRange = String(updates.updatedRange ?? '');
  const updatedRows = Number(updates.updatedRows ?? 0);
  const updatedCells = Number(updates.updatedCells ?? 0);
  const updatedColumns = Number(updates.updatedColumns ?? 0);

  const parts = [`Rows appended.`];
  if (updatedRange) parts.push(`\n**Range:** ${updatedRange}`);
  parts.push(`\n**Rows:** ${updatedRows}`);
  if (updatedColumns) parts.push(`\n**Columns:** ${updatedColumns}`);
  parts.push(`\n**Cells:** ${updatedCells}`);

  return {
    text: parts.join(''),
    refs: { spreadsheetId, updatedRange, updatedRows, updatedCells, updatedColumns },
  };
}

// --- Custom handlers ---

/**
 * updateValues — write a 2D values array to a range.
 *
 * The manifest/factory can't express request bodies, so this handler
 * assembles the body from user-friendly params and calls the API
 * directly via `--json`. Accepts either `values` (CSV for a single row)
 * or `jsonValues` (JSON 2D array, e.g. '[["a","b"],["c","d"]]').
 */
async function updateValuesHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const range = requireString(params, 'range');
  const valueInputOption = params.valueInputOption
    ? String(params.valueInputOption)
    : 'USER_ENTERED';

  let values: unknown[][];
  if (typeof params.jsonValues === 'string' && params.jsonValues.trim()) {
    try {
      const parsed = JSON.parse(params.jsonValues);
      if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
        throw new Error('jsonValues must be a JSON 2D array, e.g. [["a","b"],["c","d"]]');
      }
      values = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid jsonValues: ${message}`);
    }
  } else if (typeof params.values === 'string' && params.values.trim()) {
    values = [parseCsvLine(params.values)];
  } else {
    throw new Error('updateValues requires either values (CSV row) or jsonValues (JSON 2D array)');
  }

  const result = await execute([
    'sheets', 'spreadsheets', 'values', 'update',
    '--params', JSON.stringify({ spreadsheetId, range, valueInputOption }),
    '--json', JSON.stringify({ range, majorDimension: 'ROWS', values }),
  ], { account });

  const data = (result.data ?? {}) as Record<string, unknown>;
  const updatedRange = String(data.updatedRange ?? range);
  const updatedRows = Number(data.updatedRows ?? values.length);
  const updatedCells = Number(data.updatedCells ?? values.reduce((n, r) => n + (r?.length ?? 0), 0));
  const updatedColumns = Number(data.updatedColumns ?? 0);

  const parts = [`Values written.`, `\n**Range:** ${updatedRange}`, `\n**Rows:** ${updatedRows}`];
  if (updatedColumns) parts.push(`\n**Columns:** ${updatedColumns}`);
  parts.push(`\n**Cells:** ${updatedCells}`, `\n**Value input:** ${valueInputOption}`);

  return {
    text: parts.join(''),
    refs: { spreadsheetId, updatedRange, updatedRows, updatedCells, updatedColumns, valueInputOption },
  };
}

/** Parse a sheetId param — Google assigns integers and `0` is valid. */
function requireSheetId(params: Record<string, unknown>, field = 'sheetId'): number {
  const raw = params[field];
  if (raw === undefined || raw === null || raw === '') {
    throw new Error(`${field} is required (integer, from manage_sheets get)`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`${field} must be an integer, got: ${String(raw)}`);
  }
  return n;
}

/** Run a single-request batchUpdate and return the first reply. */
async function runBatchUpdate(
  spreadsheetId: string,
  request: Record<string, unknown>,
  account: string,
): Promise<Record<string, unknown>> {
  const result = await execute([
    'sheets', 'spreadsheets', 'batchUpdate',
    '--params', JSON.stringify({ spreadsheetId }),
    '--json', JSON.stringify({ requests: [request] }),
  ], { account });
  const data = (result.data ?? {}) as Record<string, unknown>;
  const replies = (data.replies as Array<Record<string, unknown>> | undefined) ?? [];
  return replies[0] ?? {};
}

/**
 * addSheet — append a new tab. Accepts `title`, optional `rowCount`/`columnCount`
 * and `index` (position among tabs). Returns the new sheetId.
 */
async function addSheetHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const title = requireString(params, 'title');
  const properties: Record<string, unknown> = { title };

  if (params.index !== undefined && params.index !== null && params.index !== '') {
    const idx = Number(params.index);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error('index must be a non-negative integer');
    }
    properties.index = idx;
  }

  const rowCount = params.rowCount !== undefined && params.rowCount !== '' ? Number(params.rowCount) : undefined;
  const columnCount = params.columnCount !== undefined && params.columnCount !== '' ? Number(params.columnCount) : undefined;
  if (rowCount !== undefined || columnCount !== undefined) {
    properties.gridProperties = {
      ...(rowCount !== undefined ? { rowCount } : {}),
      ...(columnCount !== undefined ? { columnCount } : {}),
    };
  }

  const reply = await runBatchUpdate(spreadsheetId, { addSheet: { properties } }, account);
  const addedProps = ((reply.addSheet as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;
  const newSheetId = addedProps.sheetId;
  const newTitle = addedProps.title ?? title;
  const grid = (addedProps.gridProperties ?? {}) as Record<string, unknown>;

  return {
    text: `Sheet added: **${newTitle}**\n\n**Sheet ID:** ${newSheetId}\n**Rows:** ${grid.rowCount ?? '?'}\n**Columns:** ${grid.columnCount ?? '?'}`,
    refs: { spreadsheetId, sheetId: newSheetId, title: newTitle },
  };
}

/** renameSheet — update a tab's title. */
async function renameSheetHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const sheetId = requireSheetId(params);
  const title = requireString(params, 'title');

  await runBatchUpdate(spreadsheetId, {
    updateSheetProperties: {
      properties: { sheetId, title },
      fields: 'title',
    },
  }, account);

  return {
    text: `Sheet renamed.\n\n**Sheet ID:** ${sheetId}\n**New title:** ${title}`,
    refs: { spreadsheetId, sheetId, title },
  };
}

/** deleteSheet — remove a tab. Irreversible. */
async function deleteSheetHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const sheetId = requireSheetId(params);

  await runBatchUpdate(spreadsheetId, { deleteSheet: { sheetId } }, account);

  return {
    text: `Sheet deleted.\n\n**Sheet ID:** ${sheetId}`,
    refs: { spreadsheetId, sheetId, deleted: true },
  };
}

/** duplicateSheet — copy a tab within the same spreadsheet. */
async function duplicateSheetHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const sourceSheetId = requireSheetId(params, 'sheetId');
  const newSheetName = params.title ? String(params.title) : undefined;

  const request: Record<string, unknown> = { duplicateSheet: { sourceSheetId } };
  if (newSheetName) (request.duplicateSheet as Record<string, unknown>).newSheetName = newSheetName;
  if (params.index !== undefined && params.index !== '') {
    const idx = Number(params.index);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error('index must be a non-negative integer');
    }
    (request.duplicateSheet as Record<string, unknown>).insertSheetIndex = idx;
  }

  const reply = await runBatchUpdate(spreadsheetId, request, account);
  const newProps = ((reply.duplicateSheet as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;

  return {
    text: `Sheet duplicated.\n\n**Source sheet ID:** ${sourceSheetId}\n**New sheet ID:** ${newProps.sheetId ?? 'unknown'}\n**New title:** ${newProps.title ?? newSheetName ?? '?'}`,
    refs: { spreadsheetId, sourceSheetId, sheetId: newProps.sheetId, title: newProps.title },
  };
}

/** renameSpreadsheet — rename the spreadsheet (the doc title, not a tab). */
async function renameSpreadsheetHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const title = requireString(params, 'title');

  await runBatchUpdate(spreadsheetId, {
    updateSpreadsheetProperties: {
      properties: { title },
      fields: 'title',
    },
  }, account);

  return {
    text: `Spreadsheet renamed.\n\n**Spreadsheet ID:** ${spreadsheetId}\n**New title:** ${title}`,
    refs: { spreadsheetId, title },
  };
}

/**
 * copySheetTo — copy a tab to another spreadsheet.
 * spreadsheets.sheets.copyTo takes a --json body with destinationSpreadsheetId.
 */
async function copySheetToHandler(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const spreadsheetId = requireString(params, 'spreadsheetId');
  const sheetId = requireSheetId(params);
  const destinationSpreadsheetId = requireString(params, 'destinationSpreadsheetId');

  const result = await execute([
    'sheets', 'spreadsheets', 'sheets', 'copyTo',
    '--params', JSON.stringify({ spreadsheetId, sheetId }),
    '--json', JSON.stringify({ destinationSpreadsheetId }),
  ], { account });

  const data = (result.data ?? {}) as Record<string, unknown>;
  return {
    text: `Sheet copied.\n\n**Source:** ${spreadsheetId} (sheet ${sheetId})\n**Destination:** ${destinationSpreadsheetId}\n**New sheet ID:** ${data.sheetId ?? 'unknown'}\n**New title:** ${data.title ?? '?'}`,
    refs: {
      spreadsheetId,
      sourceSheetId: sheetId,
      destinationSpreadsheetId,
      sheetId: data.sheetId,
      title: data.title,
    },
  };
}

// --- Patch export ---

export const sheetsPatch: ServicePatch = {
  formatDetail: (data: unknown, ctx: PatchContext): HandlerResponse => {
    switch (ctx.operation) {
      case 'read':
      case 'getValues':
        return formatValuesDetail(data);
      case 'get':
        return formatSpreadsheetDetail(data);
      default:
        return formatSpreadsheetDetail(data);
    }
  },

  formatAction: (data: unknown, ctx: PatchContext): HandlerResponse => {
    switch (ctx.operation) {
      case 'create':
        return formatCreateAction(data);
      case 'append':
        return formatAppendAction(data);
      case 'clearValues':
        return formatClearAction(data);
      default: {
        const raw = (data ?? {}) as Record<string, unknown>;
        return {
          text: 'Operation completed.',
          refs: { ...raw },
        };
      }
    }
  },

  customHandlers: {
    updateValues: updateValuesHandler,
    addSheet: addSheetHandler,
    renameSheet: renameSheetHandler,
    deleteSheet: deleteSheetHandler,
    duplicateSheet: duplicateSheetHandler,
    renameSpreadsheet: renameSpreadsheetHandler,
    copySheetTo: copySheetToHandler,
  },
};
