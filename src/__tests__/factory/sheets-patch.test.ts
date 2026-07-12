/**
 * Tests for the sheets service patch — formatters preserve the `values`
 * and `sheets` arrays that the generic detail formatter drops, and
 * `updateValues` writes a request body the manifest can't express.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every sheets custom handler is a RESOURCE op — none of them shell out to gws
// any more (ADR-103). A mocked `call()` resolves to raw Google JSON; there is no
// { success, data, stderr } envelope.
vi.mock('../../google/client.js');
import { mockCall } from '../server/handlers/__mocks__/client.js';
import { requestFor, queryOf } from '../support/request.js';
import { sheetsPatch } from '../../services/sheets/patch.js';
import type { PatchContext } from '../../factory/types.js';

const ctx = (operation: string): PatchContext => ({
  operation,
  params: {},
  account: 'user@test.com',
});

describe('sheetsPatch formatDetail', () => {
  it('read renders the values array with sheet row-number prefixes', () => {
    const data = {
      range: "'Clean Logs'!A1:C2",
      majorDimension: 'ROWS',
      values: [
        ['Date', 'Level', 'Message'],
        ['2026-04-15', 'INFO', 'started'],
      ],
    };
    const res = sheetsPatch.formatDetail!(data, ctx('read'));
    expect(res.text).toContain("'Clean Logs'!A1:C2");
    expect(res.text).toContain('R1: Date | Level | Message');
    expect(res.text).toContain('R2: 2026-04-15 | INFO | started');
    expect(res.text).toContain('**Rows:** 2');
    expect(res.text).toContain('**Columns:** 3');
    expect(res.refs.values).toEqual(data.values);
    expect(res.refs.rowCount).toBe(2);
    expect(res.refs.startRow).toBe(1);
  });

  it('numbers rows from the start of the requested range, not from 1', () => {
    // The Sheets API omits leading-blank rows from `values`; the response
    // `range` is what tells you where row 1 of the array actually sits.
    const res = sheetsPatch.formatDetail!(
      {
        range: "'Invoice'!G2:H4",
        majorDimension: 'ROWS',
        values: [['4/20/2026', ''], ['Aaron Bockelie', ''], ['', '$1,234']],
      },
      ctx('read'),
    );
    expect(res.text).toContain('R2: 4/20/2026 |');
    expect(res.text).toContain('R3: Aaron Bockelie |');
    expect(res.text).toContain('R4:  | $1,234');
    expect(res.refs.startRow).toBe(2);
  });

  it('renders a fully-blank row as a bare Rn: so it is visible', () => {
    const res = sheetsPatch.formatDetail!(
      { range: 'Sheet1!A1:B3', majorDimension: 'ROWS', values: [[], [], ['data', 'here']] },
      ctx('getValues'),
    );
    expect(res.text).toContain('R1:\n');
    expect(res.text).toContain('R2:\n');
    expect(res.text).toContain('R3: data | here');
  });

  it('pads row numbers so the colons line up across digit widths', () => {
    const values = Array.from({ length: 11 }, (_, i) => [`v${i + 1}`]);
    const res = sheetsPatch.formatDetail!(
      { range: 'Sheet1!A1:A11', majorDimension: 'ROWS', values },
      ctx('read'),
    );
    expect(res.text).toContain('R 1: v1');
    expect(res.text).toContain('R11: v11');
  });

  it('getValues uses the same row-prefixed renderer', () => {
    const res = sheetsPatch.formatDetail!(
      { range: 'Sheet1!A1:B1', majorDimension: 'ROWS', values: [['a', 'b']] },
      ctx('getValues'),
    );
    expect(res.text).toContain('R1: a | b');
  });

  it('read handles empty range gracefully', () => {
    const res = sheetsPatch.formatDetail!(
      { range: 'Sheet1!A1:A1', majorDimension: 'ROWS' },
      ctx('read'),
    );
    expect(res.text).toContain('**Rows:** 0');
    expect(res.text).toContain('_(empty range)_');
  });

  it('escapes pipe characters so they do not break the table', () => {
    const res = sheetsPatch.formatDetail!(
      { range: 'S!A1', majorDimension: 'ROWS', values: [['a|b', 'c']] },
      ctx('read'),
    );
    expect(res.text).toContain('R1: a\\|b | c');
  });

  it('get renders spreadsheet metadata including sheet tabs', () => {
    const data = {
      spreadsheetId: 'sheet123',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123',
      properties: { title: 'Budget', locale: 'en_US', timeZone: 'America/New_York' },
      sheets: [
        { properties: { sheetId: 0, title: 'Summary', gridProperties: { rowCount: 100, columnCount: 26 } } },
        { properties: { sheetId: 1, title: 'Details', gridProperties: { rowCount: 500, columnCount: 10 } } },
      ],
    };
    const res = sheetsPatch.formatDetail!(data, ctx('get'));
    expect(res.text).toContain('## Budget');
    expect(res.text).toContain('**Spreadsheet ID:** sheet123');
    expect(res.text).toContain('### Sheets (2)');
    expect(res.text).toContain('**Summary** (sheetId: 0) — 100 rows × 26 cols');
    expect(res.text).toContain('**Details** (sheetId: 1) — 500 rows × 10 cols');
    expect(res.refs.spreadsheetId).toBe('sheet123');
    expect(Array.isArray(res.refs.sheets)).toBe(true);
  });
});

describe('sheetsPatch formatAction', () => {
  it('create surfaces spreadsheetId and url', () => {
    const res = sheetsPatch.formatAction!(
      {
        spreadsheetId: 'new1',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new1',
        properties: { title: 'New' },
        sheets: [{ properties: { title: 'Sheet1' } }],
      },
      ctx('create'),
    );
    expect(res.text).toContain('**Spreadsheet ID:** new1');
    expect(res.text).toContain('**URL:** https://docs.google.com/spreadsheets/d/new1');
    expect(res.text).toContain('**Sheets:** Sheet1');
    expect(res.refs.spreadsheetId).toBe('new1');
  });

  it('clearValues surfaces the clearedRange', () => {
    const res = sheetsPatch.formatAction!(
      { spreadsheetId: 'sheet123', clearedRange: "'Q2'!A1:C3" },
      ctx('clearValues'),
    );
    expect(res.text).toContain('Range cleared');
    expect(res.text).toContain("**Range:** 'Q2'!A1:C3");
    expect(res.refs.clearedRange).toBe("'Q2'!A1:C3");
  });

  it('append surfaces updatedRange/rows/cells', () => {
    const res = sheetsPatch.formatAction!(
      {
        spreadsheetId: 'sheet123',
        updates: {
          updatedRange: 'Sheet1!A5:C5',
          updatedRows: 1,
          updatedColumns: 3,
          updatedCells: 3,
        },
      },
      ctx('append'),
    );
    expect(res.text).toContain('**Range:** Sheet1!A5:C5');
    expect(res.text).toContain('**Rows:** 1');
    expect(res.text).toContain('**Cells:** 3');
    expect(res.refs.updatedRange).toBe('Sheet1!A5:C5');
  });
});

describe('sheetsPatch customHandlers.create', () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it('sends title in the request body so the new sheet is named', async () => {
    mockCall.mockResolvedValueOnce({
      spreadsheetId: 'new-1',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-1',
      properties: { title: 'Q3 Forecast' },
      sheets: [{ properties: { title: 'Sheet1' } }],
    });

    const handler = sheetsPatch.customHandlers!.create!;
    const res = await handler({ title: 'Q3 Forecast' }, 'user@test.com');

    expect(mockCall).toHaveBeenCalledWith(
      'sheets',
      'spreadsheets.create',
      { properties: { title: 'Q3 Forecast' } },
      expect.objectContaining({ account: 'user@test.com' }),
    );

    // title goes under properties.title in the create BODY — not into the query.
    // The old assertion read that off a `--json` argv slot; this reads it off the
    // request the descriptor actually produces.
    const request = await requestFor('sheets', 'spreadsheets.create', mockCall.mock.calls[0][2]);
    expect(request.body).toEqual({ properties: { title: 'Q3 Forecast' } });
    expect(queryOf(request)).toEqual({});

    expect(res.text).toContain('Spreadsheet created: **Q3 Forecast**');
    expect(res.text).toContain('**Spreadsheet ID:** new-1');
    expect(res.refs.spreadsheetId).toBe('new-1');
    expect(res.refs.title).toBe('Q3 Forecast');
  });

  it('sends no request body at all when no title is given (Untitled spreadsheet)', async () => {
    mockCall.mockResolvedValueOnce({
      spreadsheetId: 'new-2',
      properties: { title: 'Untitled spreadsheet' },
      sheets: [],
    });

    const handler = sheetsPatch.customHandlers!.create!;
    await handler({}, 'user@test.com');

    expect(mockCall.mock.calls[0][2]).toEqual({});
    const request = await requestFor('sheets', 'spreadsheets.create', {});
    expect(request.body).toBeUndefined();
  });
});

describe('sheetsPatch customHandlers.updateValues', () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  const okResponse = {
    spreadsheetId: 'sheet123',
    updatedRange: 'Sheet1!A1:B1',
    updatedRows: 1,
    updatedColumns: 2,
    updatedCells: 2,
  } as const;

  it('sends values in the request body with the expected shape', async () => {
    mockCall.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    const res = await handler(
      {
        spreadsheetId: 'sheet123',
        range: 'Sheet1!A1:B1',
        jsonValues: '[["a","b"]]',
      },
      'user@test.com',
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
    const [service, resourcePath, params] = mockCall.mock.calls[0];
    expect(service).toBe('sheets');
    expect(resourcePath).toBe('spreadsheets.values.update');
    expect(params).toEqual({
      spreadsheetId: 'sheet123',
      range: 'Sheet1!A1:B1',
      valueInputOption: 'USER_ENTERED',
      majorDimension: 'ROWS',
      values: [['a', 'b']],
    });

    // Placement: values/majorDimension are the BODY, spreadsheetId/range are the
    // PATH, valueInputOption is the QUERY — checked against the descriptor the
    // client actually dispatches on, which is stronger than what argv could say.
    const request = await requestFor('sheets', 'spreadsheets.values.update', params);
    expect(request.method).toBe('PUT');
    expect(request.body).toEqual({ majorDimension: 'ROWS', values: [['a', 'b']] });
    expect(queryOf(request)).toEqual({ valueInputOption: 'USER_ENTERED' });
    expect(request.url).toContain('/spreadsheets/sheet123/values/');

    expect(res.text).toContain('**Range:** Sheet1!A1:B1');
    expect(res.refs.updatedCells).toBe(2);
  });

  it('accepts CSV values for single-row writes', async () => {
    mockCall.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: 'Alice,100,true' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].values).toEqual([['Alice', '100', 'true']]);
  });

  it('honors a caller-supplied valueInputOption', async () => {
    mockCall.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    await handler(
      {
        spreadsheetId: 'sheet123',
        range: 'Sheet1!A1',
        jsonValues: '[["=1+1"]]',
        valueInputOption: 'RAW',
      },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].valueInputOption).toBe('RAW');
  });

  it('rejects malformed jsonValues', async () => {
    const handler = sheetsPatch.customHandlers!.updateValues!;
    await expect(
      handler(
        { spreadsheetId: 'sheet123', range: 'Sheet1!A1', jsonValues: '"not an array"' },
        'user@test.com',
      ),
    ).rejects.toThrow(/jsonValues must be a JSON 2D array/);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('parses CSV values with quoted fields containing commas', async () => {
    mockCall.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: '"Smith, John",42,"Remote, WFH"' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].values).toEqual([['Smith, John', '42', 'Remote, WFH']]);
  });

  it('parses CSV values with escaped double quotes', async () => {
    mockCall.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    // Google-style CSV escaping: a doubled quote inside a quoted field is a literal quote.
    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: '"She said ""hi""",ok' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].values).toEqual([['She said "hi"', 'ok']]);
  });

  it('requires either values or jsonValues', async () => {
    const handler = sheetsPatch.customHandlers!.updateValues!;
    await expect(
      handler({ spreadsheetId: 'sheet123', range: 'Sheet1!A1' }, 'user@test.com'),
    ).rejects.toThrow(/values .* or jsonValues/);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('sheetsPatch customHandlers.append', () => {
  beforeEach(() => mockCall.mockReset());

  const apiResponse = {
    spreadsheetId: 'sheet123',
    tableRange: "'Q2 Metrics'!A1:C3",
    updates: {
      updatedRange: "'Q2 Metrics'!A4:C4",
      updatedRows: 1,
      updatedColumns: 3,
      updatedCells: 3,
    },
  } as const;

  it('hits spreadsheets.values.append (not the +append helper)', async () => {
    mockCall.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics', jsonValues: '[["a","b","c"]]' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][0]).toBe('sheets');
    expect(mockCall.mock.calls[0][1]).toBe('spreadsheets.values.append');
  });

  it('passes the range through to the URL (fixes the Sheet1-only bug)', async () => {
    mockCall.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics!A:Z', jsonValues: '[["a","b"]]' },
      'user@test.com',
    );

    const params = mockCall.mock.calls[0][2];
    expect(params.range).toBe('Q2 Metrics!A:Z');
    expect(params.valueInputOption).toBe('USER_ENTERED');
    // `range` is a PATH param — it must reach the URL, which is exactly what the
    // gws `+append` helper (no --range flag) could never do.
    const request = await requestFor('sheets', 'spreadsheets.values.append', params);
    expect(decodeURIComponent(new URL(request.url).pathname)).toContain('/values/Q2 Metrics!A:Z:append');
  });

  it('defaults range to Sheet1 when omitted (backward compatible)', async () => {
    mockCall.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', jsonValues: '[["a"]]' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].range).toBe('Sheet1');
  });

  it('accepts CSV values for single-row appends', async () => {
    mockCall.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics', values: 'Alice,100,true' },
      'user@test.com',
    );

    expect(mockCall.mock.calls[0][2].values).toEqual([['Alice', '100', 'true']]);
  });

  it('surfaces the updated range from the response', async () => {
    mockCall.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    const res = await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics', jsonValues: '[["a","b","c"]]' },
      'user@test.com',
    );

    expect(res.text).toContain("'Q2 Metrics'!A4:C4");
    expect(res.refs.updatedRows).toBe(1);
    expect(res.refs.updatedCells).toBe(3);
  });

  it('rejects missing values input', async () => {
    const handler = sheetsPatch.customHandlers!.append!;
    await expect(
      handler({ spreadsheetId: 'sheet123', range: 'Q2 Metrics' }, 'user@test.com'),
    ).rejects.toThrow(/append requires .* values .* jsonValues/);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

// --- Tab management (batchUpdate-based customHandlers) ---

/** Assert batchUpdate was called with the expected single-request body. */
async function expectBatchUpdateCall(
  callArgs: readonly unknown[],
  expectedSpreadsheetId: string,
  expectedRequest: Record<string, unknown>,
): Promise<void> {
  const [service, resourcePath, params] = callArgs as [string, string, Record<string, unknown>];
  expect(service).toBe('sheets');
  expect(resourcePath).toBe('spreadsheets.batchUpdate');
  expect(params).toEqual({ spreadsheetId: expectedSpreadsheetId, requests: [expectedRequest] });
  // spreadsheetId is the PATH; `requests` is the BODY.
  const request = await requestFor('sheets', 'spreadsheets.batchUpdate', params);
  expect(request.url).toContain(`/spreadsheets/${expectedSpreadsheetId}:batchUpdate`);
  expect(request.body).toEqual({ requests: [expectedRequest] });
}

describe('sheetsPatch customHandlers.addSheet', () => {
  beforeEach(() => mockCall.mockReset());

  it('sends addSheet with title and returns the new sheetId', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{
        addSheet: { properties: { sheetId: 42, title: 'Logs', gridProperties: { rowCount: 1000, columnCount: 26 } } },
      }],
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', title: 'Logs' },
      'user@test.com',
    );

    await expectBatchUpdateCall(mockCall.mock.calls[0], 'sheet123', {
      addSheet: { properties: { title: 'Logs' } },
    });
    expect(res.text).toContain('**Sheet ID:** 42');
    expect(res.text).toContain('Logs');
    expect(res.refs.sheetId).toBe(42);
  });

  it('passes gridProperties when rowCount/columnCount provided', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{ addSheet: { properties: { sheetId: 1, title: 'Big', gridProperties: { rowCount: 500, columnCount: 10 } } } }],
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await handler(
      { spreadsheetId: 'sheet123', title: 'Big', rowCount: 500, columnCount: 10 },
      'user@test.com',
    );
    const requests = mockCall.mock.calls[0][2].requests as Array<Record<string, any>>;
    expect(requests[0].addSheet.properties.gridProperties).toEqual({ rowCount: 500, columnCount: 10 });
  });

  it('passes index when provided', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{ addSheet: { properties: { sheetId: 2, title: 'First', gridProperties: {} } } }],
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await handler(
      { spreadsheetId: 'sheet123', title: 'First', index: 0 },
      'user@test.com',
    );
    const requests = mockCall.mock.calls[0][2].requests as Array<Record<string, any>>;
    expect(requests[0].addSheet.properties.index).toBe(0);
  });

  it('rejects missing title', async () => {
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await expect(handler({ spreadsheetId: 'sheet123' }, 'user@test.com'))
      .rejects.toThrow(/title is required/);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('sheetsPatch customHandlers.renameSheet', () => {
  beforeEach(() => mockCall.mockReset());

  it('sends updateSheetProperties with title fieldmask', async () => {
    mockCall.mockResolvedValueOnce({ replies: [{}] });
    const handler = sheetsPatch.customHandlers!.renameSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 7, title: 'Renamed' },
      'user@test.com',
    );

    await expectBatchUpdateCall(mockCall.mock.calls[0], 'sheet123', {
      updateSheetProperties: {
        properties: { sheetId: 7, title: 'Renamed' },
        fields: 'title',
      },
    });
    expect(res.text).toContain('**Sheet ID:** 7');
    expect(res.text).toContain('**New title:** Renamed');
  });

  it('accepts sheetId = 0 (valid Google Sheets ID)', async () => {
    mockCall.mockResolvedValueOnce({ replies: [{}] });
    const handler = sheetsPatch.customHandlers!.renameSheet!;
    await handler(
      { spreadsheetId: 'sheet123', sheetId: 0, title: 'Main' },
      'user@test.com',
    );
    const requests = mockCall.mock.calls[0][2].requests as Array<Record<string, any>>;
    expect(requests[0].updateSheetProperties.properties.sheetId).toBe(0);
  });

  it('rejects non-integer sheetId', async () => {
    const handler = sheetsPatch.customHandlers!.renameSheet!;
    await expect(
      handler({ spreadsheetId: 'sheet123', sheetId: 'abc', title: 'X' }, 'user@test.com'),
    ).rejects.toThrow(/sheetId must be an integer/);
  });

  it('rejects missing sheetId', async () => {
    const handler = sheetsPatch.customHandlers!.renameSheet!;
    await expect(
      handler({ spreadsheetId: 'sheet123', title: 'X' }, 'user@test.com'),
    ).rejects.toThrow(/sheetId is required/);
  });
});

describe('sheetsPatch customHandlers.deleteSheet', () => {
  beforeEach(() => mockCall.mockReset());

  it('sends deleteSheet with the sheetId', async () => {
    mockCall.mockResolvedValueOnce({ replies: [{}] });
    const handler = sheetsPatch.customHandlers!.deleteSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 99 },
      'user@test.com',
    );

    await expectBatchUpdateCall(mockCall.mock.calls[0], 'sheet123', {
      deleteSheet: { sheetId: 99 },
    });
    expect(res.refs.deleted).toBe(true);
  });
});

describe('sheetsPatch customHandlers.duplicateSheet', () => {
  beforeEach(() => mockCall.mockReset());

  it('sends duplicateSheet with source id and optional name/index', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{ duplicateSheet: { properties: { sheetId: 101, title: 'Logs Copy' } } }],
    });
    const handler = sheetsPatch.customHandlers!.duplicateSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 10, title: 'Logs Copy', index: 2 },
      'user@test.com',
    );

    await expectBatchUpdateCall(mockCall.mock.calls[0], 'sheet123', {
      duplicateSheet: {
        sourceSheetId: 10,
        newSheetName: 'Logs Copy',
        insertSheetIndex: 2,
      },
    });
    expect(res.refs.sheetId).toBe(101);
  });

  it('omits optional fields when not provided', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{ duplicateSheet: { properties: { sheetId: 102, title: 'Copy of Logs' } } }],
    });
    const handler = sheetsPatch.customHandlers!.duplicateSheet!;
    await handler(
      { spreadsheetId: 'sheet123', sheetId: 10 },
      'user@test.com',
    );
    const requests = mockCall.mock.calls[0][2].requests as Array<Record<string, any>>;
    expect(requests[0].duplicateSheet).toEqual({ sourceSheetId: 10 });
  });
});

describe('sheetsPatch customHandlers.renameSpreadsheet', () => {
  beforeEach(() => mockCall.mockReset());

  it('sends updateSpreadsheetProperties with title fieldmask', async () => {
    mockCall.mockResolvedValueOnce({ replies: [{}] });
    const handler = sheetsPatch.customHandlers!.renameSpreadsheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', title: 'Q2 Budget' },
      'user@test.com',
    );

    await expectBatchUpdateCall(mockCall.mock.calls[0], 'sheet123', {
      updateSpreadsheetProperties: {
        properties: { title: 'Q2 Budget' },
        fields: 'title',
      },
    });
    expect(res.refs.title).toBe('Q2 Budget');
  });
});

describe('sheetsPatch customHandlers.copySheetTo', () => {
  beforeEach(() => mockCall.mockReset());

  it('calls sheets.copyTo with the destination in the request body', async () => {
    mockCall.mockResolvedValueOnce({ sheetId: 500, title: 'Imported Logs' });
    const handler = sheetsPatch.customHandlers!.copySheetTo!;

    const res = await handler(
      { spreadsheetId: 'srcSheet', sheetId: 5, destinationSpreadsheetId: 'dstSheet' },
      'user@test.com',
    );

    const [service, resourcePath, params] = mockCall.mock.calls[0];
    expect(service).toBe('sheets');
    expect(resourcePath).toBe('spreadsheets.sheets.copyTo');
    expect(params).toEqual({
      spreadsheetId: 'srcSheet',
      sheetId: 5,
      destinationSpreadsheetId: 'dstSheet',
    });

    // spreadsheetId + sheetId are PATH params; destinationSpreadsheetId is the BODY.
    const request = await requestFor('sheets', 'spreadsheets.sheets.copyTo', params);
    expect(request.url).toContain('/spreadsheets/srcSheet/sheets/5:copyTo');
    expect(request.body).toEqual({ destinationSpreadsheetId: 'dstSheet' });

    expect(res.refs.destinationSpreadsheetId).toBe('dstSheet');
    expect(res.refs.sheetId).toBe(500);
  });

  it('rejects missing destinationSpreadsheetId', async () => {
    const handler = sheetsPatch.customHandlers!.copySheetTo!;
    await expect(
      handler({ spreadsheetId: 'srcSheet', sheetId: 5 }, 'user@test.com'),
    ).rejects.toThrow(/destinationSpreadsheetId is required/);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    mockCall.mockRejectedValueOnce(new Error('destination spreadsheet not found'));
    const handler = sheetsPatch.customHandlers!.copySheetTo!;
    await expect(
      handler(
        { spreadsheetId: 'srcSheet', sheetId: 5, destinationSpreadsheetId: 'missing' },
        'user@test.com',
      ),
    ).rejects.toThrow(/destination spreadsheet not found/);
  });
});

// Next-steps framing is now handled by the factory generator (ADR-303)
// rather than each custom handler. See generator.test.ts for the regression
// test that custom-handler responses receive the footer via the wrapper.
