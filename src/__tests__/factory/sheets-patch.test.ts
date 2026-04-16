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

  it('requires either values or jsonValues', async () => {
    const handler = sheetsPatch.customHandlers!.updateValues!;
    await expect(
      handler({ spreadsheetId: 'sheet123', range: 'Sheet1!A1' }, 'user@test.com'),
    ).rejects.toThrow(/values .* or jsonValues/);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
