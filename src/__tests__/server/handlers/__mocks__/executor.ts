/**
 * Shared gws-executor mock for tests that still exercise HELPER operations.
 *
 * After ADR-103 only the helpers (`gmail +send/+reply/+triage`,
 * `calendar +agenda/+insert`, `drive +upload`) still shell out to gws; every
 * resource operation goes through the client we own. So this helper is now the
 * NARROW case — for a resource operation, mock the client instead (`./client.ts`)
 * and use the raw fixtures in `./fixtures.ts`.
 *
 * A test file may legitimately need BOTH: a handler whose helper op runs through
 * `execute()` and whose resource ops run through `call()`.
 */
import { vi, type MockedFunction } from 'vitest';

import type { GwsResult } from '../../../../executor/gws.js';

// NOTE: vi.mock() is deliberately NOT called here. Vitest hoists vi.mock only
// within the file that contains it, so registering it in this helper made the
// mock depend on each test importing this module *before* the module under
// test — an import reorder (or an organize-imports autofix) silently broke it.
// Each consuming test file registers the mock itself.

import { execute } from '../../../../executor/gws.js';

// The cast below is a promise the type system cannot keep: if the importing test
// forgot its vi.mock, `execute` is the REAL executor and every assertion against
// `mockExecute` would fail obscurely — or worse, the test would shell out to the
// real gws binary against live Google APIs. Fail loudly, at import, instead.
if (!vi.isMockFunction(execute)) {
  throw new Error(
    'executor mock helper: the gws executor is not mocked.\n' +
    'Add a vi.mock for the executor to the TEST FILE that imports this helper — ' +
    'vitest hoists vi.mock per-file, so registering it here would only work by ' +
    'import-order luck.\n' +
    "The specifier is relative to YOUR test file, e.g. vi.mock('../../../executor/gws.js') " +
    "from src/__tests__/server/handlers/, or vi.mock('../../executor/gws.js') from " +
    'src/__tests__/factory/.',
  );
}

export const mockExecute = execute as MockedFunction<typeof execute>;

/**
 * The gws stdout envelope. Only the surviving helper calls return this shape —
 * `call()` returns raw Google JSON, so a client mock never needs this wrapper.
 */
export function mockGwsResponse(data: unknown): GwsResult {
  return { success: true, data, stderr: '' };
}

// --- gws INVENTIONS ---
//
// These two shapes have no Google method behind them: gws synthesised them, and
// the Gmail/Calendar APIs never emit them. They are here because `+triage` and
// `+agenda` are still helper operations. Do NOT copy either shape into a
// client-based fixture — the real Gmail path is
// messages.list -> { messages: [{ id, threadId }] } then messages.get ->
// payload.headers[{ name, value }]. See ADR-103.

export const gmailTriageResponse = {
  messages: [
    { id: 'msg-1', from: 'alice@test.com', subject: 'Hello', date: 'Mon, 10 Mar 2026 10:00:00 -0500' },
    { id: 'msg-2', from: 'bob@test.com', subject: 'Meeting', date: 'Mon, 10 Mar 2026 11:00:00 -0500' },
  ],
};

export const calendarAgendaResponse = {
  events: [
    { calendar: 'user@test.com', summary: 'Standup', start: '2026-03-14T09:00:00Z', end: '2026-03-14T09:30:00Z' },
  ],
  timeMin: '2026-03-14T00:00:00Z',
  timeMax: '2026-03-14T23:59:59Z',
};
