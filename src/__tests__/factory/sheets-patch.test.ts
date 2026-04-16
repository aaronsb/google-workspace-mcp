/**
 * Tests for the sheets service patch — formatters preserve the `values`
 * and `sheets` arrays that the generic detail formatter drops, and
 * `updateValues` writes a request body the manifest can't express.
 */

jest.mock('../../executor/gws.js');
import { execute } from '../../executor/gws.js';
import { sheetsPatch } from '../../services/sheets/patch.js';
import type { PatchContext } from '../../factory/types.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;

const ctx = (operation: string): PatchContext => ({
  operation,
  params: {},
  account: 'user@test.com',
});

describe('sheetsPatch formatDetail', () => {
  it('read renders the values array as a markdown table', () => {
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
    expect(res.text).toContain('Date | Level | Message');
    expect(res.text).toContain('2026-04-15 | INFO | started');
    expect(res.text).toContain('**Rows:** 2');
    expect(res.text).toContain('**Columns:** 3');
    expect(res.refs.values).toEqual(data.values);
    expect(res.refs.rowCount).toBe(2);
  });

  it('getValues uses the same values renderer', () => {
    const res = sheetsPatch.formatDetail!(
      { range: 'Sheet1!A1:B1', majorDimension: 'ROWS', values: [['a', 'b']] },
      ctx('getValues'),
    );
    expect(res.text).toContain('a | b');
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
    expect(res.text).toContain('a\\|b | c');
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

describe('sheetsPatch customHandlers.updateValues', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  const okResponse = {
    success: true,
    data: {
      spreadsheetId: 'sheet123',
      updatedRange: 'Sheet1!A1:B1',
      updatedRows: 1,
      updatedColumns: 2,
      updatedCells: 2,
    },
    stderr: '',
  } as const;

  it('sends values via --json with the expected body shape', async () => {
    mockExecute.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    const res = await handler(
      {
        spreadsheetId: 'sheet123',
        range: 'Sheet1!A1:B1',
        jsonValues: '[["a","b"]]',
      },
      'user@test.com',
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const args = mockExecute.mock.calls[0][0];
    expect(args.slice(0, 4)).toEqual(['sheets', 'spreadsheets', 'values', 'update']);

    const jsonIdx = args.indexOf('--json');
    expect(jsonIdx).toBeGreaterThan(-1);
    const body = JSON.parse(args[jsonIdx + 1]);
    expect(body.values).toEqual([['a', 'b']]);
    expect(body.majorDimension).toBe('ROWS');

    const paramsIdx = args.indexOf('--params');
    const params = JSON.parse(args[paramsIdx + 1]);
    expect(params).toEqual({
      spreadsheetId: 'sheet123',
      range: 'Sheet1!A1:B1',
      valueInputOption: 'USER_ENTERED',
    });

    expect(res.text).toContain('**Range:** Sheet1!A1:B1');
    expect(res.refs.updatedCells).toBe(2);
  });

  it('accepts CSV values for single-row writes', async () => {
    mockExecute.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: 'Alice,100,true' },
      'user@test.com',
    );

    const args = mockExecute.mock.calls[0][0];
    const body = JSON.parse(args[args.indexOf('--json') + 1]);
    expect(body.values).toEqual([['Alice', '100', 'true']]);
  });

  it('honors a caller-supplied valueInputOption', async () => {
    mockExecute.mockResolvedValueOnce(okResponse);
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

    const args = mockExecute.mock.calls[0][0];
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    expect(params.valueInputOption).toBe('RAW');
  });

  it('rejects malformed jsonValues', async () => {
    const handler = sheetsPatch.customHandlers!.updateValues!;
    await expect(
      handler(
        { spreadsheetId: 'sheet123', range: 'Sheet1!A1', jsonValues: '"not an array"' },
        'user@test.com',
      ),
    ).rejects.toThrow(/jsonValues must be a JSON 2D array/);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('parses CSV values with quoted fields containing commas', async () => {
    mockExecute.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: '"Smith, John",42,"Remote, WFH"' },
      'user@test.com',
    );

    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.values).toEqual([['Smith, John', '42', 'Remote, WFH']]);
  });

  it('parses CSV values with escaped double quotes', async () => {
    mockExecute.mockResolvedValueOnce(okResponse);
    const handler = sheetsPatch.customHandlers!.updateValues!;

    // Google-style CSV escaping: "" inside a quoted field = literal "
    await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', values: '"She said ""hi""",ok' },
      'user@test.com',
    );

    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.values).toEqual([['She said "hi"', 'ok']]);
  });

  it('requires either values or jsonValues', async () => {
    const handler = sheetsPatch.customHandlers!.updateValues!;
    await expect(
      handler({ spreadsheetId: 'sheet123', range: 'Sheet1!A1' }, 'user@test.com'),
    ).rejects.toThrow(/values .* or jsonValues/);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('sheetsPatch customHandlers.append', () => {
  beforeEach(() => mockExecute.mockReset());

  const apiResponse = {
    success: true,
    data: {
      spreadsheetId: 'sheet123',
      tableRange: "'Q2 Metrics'!A1:C3",
      updates: {
        updatedRange: "'Q2 Metrics'!A4:C4",
        updatedRows: 1,
        updatedColumns: 3,
        updatedCells: 3,
      },
    },
    stderr: '',
  } as const;

  it('hits spreadsheets.values.append (not the +append helper)', async () => {
    mockExecute.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics', jsonValues: '[["a","b","c"]]' },
      'user@test.com',
    );

    const args = mockExecute.mock.calls[0][0];
    expect(args.slice(0, 4)).toEqual(['sheets', 'spreadsheets', 'values', 'append']);
    // Sanity: make sure we did NOT fall back to the helper form
    expect(args).not.toContain('+append');
  });

  it('passes range through --params (fixes the Sheet1-only bug)', async () => {
    mockExecute.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics!A:Z', jsonValues: '[["a","b"]]' },
      'user@test.com',
    );

    const args = mockExecute.mock.calls[0][0];
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    expect(params.range).toBe('Q2 Metrics!A:Z');
    expect(params.valueInputOption).toBe('USER_ENTERED');
  });

  it('defaults range to Sheet1 when omitted (backward compatible)', async () => {
    mockExecute.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', jsonValues: '[["a"]]' },
      'user@test.com',
    );

    const params = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--params') + 1]);
    expect(params.range).toBe('Sheet1');
  });

  it('accepts CSV values for single-row appends', async () => {
    mockExecute.mockResolvedValueOnce(apiResponse);
    const handler = sheetsPatch.customHandlers!.append!;

    await handler(
      { spreadsheetId: 'sheet123', range: 'Q2 Metrics', values: 'Alice,100,true' },
      'user@test.com',
    );

    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.values).toEqual([['Alice', '100', 'true']]);
  });

  it('surfaces the updated range from the response', async () => {
    mockExecute.mockResolvedValueOnce(apiResponse);
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
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// --- Tab management (batchUpdate-based customHandlers) ---

/** Assert batchUpdate was called with the expected single-request body. */
function expectBatchUpdateCall(
  call: readonly string[],
  expectedSpreadsheetId: string,
  expectedRequest: Record<string, unknown>,
): void {
  expect(call.slice(0, 3)).toEqual(['sheets', 'spreadsheets', 'batchUpdate']);
  const params = JSON.parse(call[call.indexOf('--params') + 1]);
  expect(params).toEqual({ spreadsheetId: expectedSpreadsheetId });
  const body = JSON.parse(call[call.indexOf('--json') + 1]);
  expect(body).toEqual({ requests: [expectedRequest] });
}

describe('sheetsPatch customHandlers.addSheet', () => {
  beforeEach(() => mockExecute.mockReset());

  it('sends addSheet with title and returns the new sheetId', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: {
        replies: [{
          addSheet: { properties: { sheetId: 42, title: 'Logs', gridProperties: { rowCount: 1000, columnCount: 26 } } },
        }],
      },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', title: 'Logs' },
      'user@test.com',
    );

    expectBatchUpdateCall(mockExecute.mock.calls[0][0], 'sheet123', {
      addSheet: { properties: { title: 'Logs' } },
    });
    expect(res.text).toContain('**Sheet ID:** 42');
    expect(res.text).toContain('Logs');
    expect(res.refs.sheetId).toBe(42);
  });

  it('passes gridProperties when rowCount/columnCount provided', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ addSheet: { properties: { sheetId: 1, title: 'Big', gridProperties: { rowCount: 500, columnCount: 10 } } } }] },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await handler(
      { spreadsheetId: 'sheet123', title: 'Big', rowCount: 500, columnCount: 10 },
      'user@test.com',
    );
    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.requests[0].addSheet.properties.gridProperties).toEqual({ rowCount: 500, columnCount: 10 });
  });

  it('passes index when provided', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ addSheet: { properties: { sheetId: 2, title: 'First', gridProperties: {} } } }] },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await handler(
      { spreadsheetId: 'sheet123', title: 'First', index: 0 },
      'user@test.com',
    );
    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.requests[0].addSheet.properties.index).toBe(0);
  });

  it('rejects missing title', async () => {
    const handler = sheetsPatch.customHandlers!.addSheet!;
    await expect(handler({ spreadsheetId: 'sheet123' }, 'user@test.com'))
      .rejects.toThrow(/title is required/);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('sheetsPatch customHandlers.renameSheet', () => {
  beforeEach(() => mockExecute.mockReset());

  it('sends updateSheetProperties with title fieldmask', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { replies: [{}] }, stderr: '' });
    const handler = sheetsPatch.customHandlers!.renameSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 7, title: 'Renamed' },
      'user@test.com',
    );

    expectBatchUpdateCall(mockExecute.mock.calls[0][0], 'sheet123', {
      updateSheetProperties: {
        properties: { sheetId: 7, title: 'Renamed' },
        fields: 'title',
      },
    });
    expect(res.text).toContain('**Sheet ID:** 7');
    expect(res.text).toContain('**New title:** Renamed');
  });

  it('accepts sheetId = 0 (valid Google Sheets ID)', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { replies: [{}] }, stderr: '' });
    const handler = sheetsPatch.customHandlers!.renameSheet!;
    await handler(
      { spreadsheetId: 'sheet123', sheetId: 0, title: 'Main' },
      'user@test.com',
    );
    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.requests[0].updateSheetProperties.properties.sheetId).toBe(0);
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
  beforeEach(() => mockExecute.mockReset());

  it('sends deleteSheet with the sheetId', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { replies: [{}] }, stderr: '' });
    const handler = sheetsPatch.customHandlers!.deleteSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 99 },
      'user@test.com',
    );

    expectBatchUpdateCall(mockExecute.mock.calls[0][0], 'sheet123', {
      deleteSheet: { sheetId: 99 },
    });
    expect(res.refs.deleted).toBe(true);
  });
});

describe('sheetsPatch customHandlers.duplicateSheet', () => {
  beforeEach(() => mockExecute.mockReset());

  it('sends duplicateSheet with source id and optional name/index', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ duplicateSheet: { properties: { sheetId: 101, title: 'Logs Copy' } } }] },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.duplicateSheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', sheetId: 10, title: 'Logs Copy', index: 2 },
      'user@test.com',
    );

    expectBatchUpdateCall(mockExecute.mock.calls[0][0], 'sheet123', {
      duplicateSheet: {
        sourceSheetId: 10,
        newSheetName: 'Logs Copy',
        insertSheetIndex: 2,
      },
    });
    expect(res.refs.sheetId).toBe(101);
  });

  it('omits optional fields when not provided', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ duplicateSheet: { properties: { sheetId: 102, title: 'Copy of Logs' } } }] },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.duplicateSheet!;
    await handler(
      { spreadsheetId: 'sheet123', sheetId: 10 },
      'user@test.com',
    );
    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.requests[0].duplicateSheet).toEqual({ sourceSheetId: 10 });
  });
});

describe('sheetsPatch customHandlers.renameSpreadsheet', () => {
  beforeEach(() => mockExecute.mockReset());

  it('sends updateSpreadsheetProperties with title fieldmask', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { replies: [{}] }, stderr: '' });
    const handler = sheetsPatch.customHandlers!.renameSpreadsheet!;

    const res = await handler(
      { spreadsheetId: 'sheet123', title: 'Q2 Budget' },
      'user@test.com',
    );

    expectBatchUpdateCall(mockExecute.mock.calls[0][0], 'sheet123', {
      updateSpreadsheetProperties: {
        properties: { title: 'Q2 Budget' },
        fields: 'title',
      },
    });
    expect(res.refs.title).toBe('Q2 Budget');
  });
});

describe('sheetsPatch customHandlers.copySheetTo', () => {
  beforeEach(() => mockExecute.mockReset());

  it('calls sheets.copyTo with destination in --json body', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { sheetId: 500, title: 'Imported Logs' },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.copySheetTo!;

    const res = await handler(
      { spreadsheetId: 'srcSheet', sheetId: 5, destinationSpreadsheetId: 'dstSheet' },
      'user@test.com',
    );

    const args = mockExecute.mock.calls[0][0];
    expect(args.slice(0, 4)).toEqual(['sheets', 'spreadsheets', 'sheets', 'copyTo']);
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    expect(params).toEqual({ spreadsheetId: 'srcSheet', sheetId: 5 });
    const body = JSON.parse(args[args.indexOf('--json') + 1]);
    expect(body).toEqual({ destinationSpreadsheetId: 'dstSheet' });
    expect(res.refs.destinationSpreadsheetId).toBe('dstSheet');
    expect(res.refs.sheetId).toBe(500);
  });

  it('rejects missing destinationSpreadsheetId', async () => {
    const handler = sheetsPatch.customHandlers!.copySheetTo!;
    await expect(
      handler({ spreadsheetId: 'srcSheet', sheetId: 5 }, 'user@test.com'),
    ).rejects.toThrow(/destinationSpreadsheetId is required/);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('propagates gws execution errors', async () => {
    mockExecute.mockRejectedValueOnce(new Error('destination spreadsheet not found'));
    const handler = sheetsPatch.customHandlers!.copySheetTo!;
    await expect(
      handler(
        { spreadsheetId: 'srcSheet', sheetId: 5, destinationSpreadsheetId: 'missing' },
        'user@test.com',
      ),
    ).rejects.toThrow(/destination spreadsheet not found/);
  });
});

describe('sheetsPatch — nextSteps guidance (regression for PR #103 review)', () => {
  beforeEach(() => mockExecute.mockReset());

  it('updateValues appends next-steps footer to response text', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { spreadsheetId: 'sheet123', updatedRange: 'Sheet1!A1:B1', updatedRows: 1, updatedColumns: 2, updatedCells: 2 },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.updateValues!;
    const res = await handler(
      { spreadsheetId: 'sheet123', range: 'Sheet1!A1', jsonValues: '[["a","b"]]' },
      'user@test.com',
    );
    expect(res.text).toContain('Next steps:');
    expect(res.text).toContain('manage_sheets');
  });

  it('addSheet appends next-steps footer', async () => {
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ addSheet: { properties: { sheetId: 42, title: 'T', gridProperties: {} } } }] },
      stderr: '',
    });
    const handler = sheetsPatch.customHandlers!.addSheet!;
    const res = await handler(
      { spreadsheetId: 'sheet123', title: 'T' },
      'user@test.com',
    );
    expect(res.text).toContain('Next steps:');
  });

  it('resolves spreadsheetId placeholder from handler context', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { replies: [{}] }, stderr: '' });
    const handler = sheetsPatch.customHandlers!.renameSheet!;
    const res = await handler(
      { spreadsheetId: 'sheet-xyz', sheetId: 0, title: 'Main' },
      'user@test.com',
    );
    // Next-steps entry for renameSheet references <spreadsheetId> — verify resolution
    expect(res.text).toContain('sheet-xyz');
    expect(res.text).not.toContain('<spreadsheetId>');
  });
});
