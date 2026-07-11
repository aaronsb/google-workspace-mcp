/**
 * Shared executor mock for handler tests.
 *
 * Provides typed mock responses matching gws output contracts
 * so handlers can be tested without spawning subprocesses.
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
    "executor mock helper: '../../executor/gws.js' is not mocked.\n" +
    "Add `vi.mock('<relative path>/executor/gws.js');` to the TEST FILE that " +
    'imports this helper — vitest hoists vi.mock per-file, so registering it ' +
    'here would only work by import-order luck.',
  );
}

export const mockExecute = execute as MockedFunction<typeof execute>;

export function mockGwsResponse(data: unknown): GwsResult {
  return { success: true, data, stderr: '' };
}

// --- Gmail contract responses ---

export const gmailTriageResponse = {
  messages: [
    { id: 'msg-1', from: 'alice@test.com', subject: 'Hello', date: 'Mon, 10 Mar 2026 10:00:00 -0500' },
    { id: 'msg-2', from: 'bob@test.com', subject: 'Meeting', date: 'Mon, 10 Mar 2026 11:00:00 -0500' },
  ],
};

export const gmailMessageListResponse = {
  messages: [
    { id: 'msg-1', threadId: 'thread-1' },
    { id: 'msg-2', threadId: 'thread-2' },
  ],
};

// Metadata responses for hydration (format: metadata)
export function gmailMetadataResponse(id: string, from: string, subject: string, date: string) {
  return {
    id,
    threadId: `thread-${id}`,
    snippet: `Preview of ${subject}`,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: date },
      ],
    },
  };
}

export const gmailMessageDetailResponse = {
  id: 'msg-1',
  threadId: 'thread-1',
  snippet: 'Preview text...',
  labelIds: ['INBOX'],
  payload: {
    headers: [
      { name: 'From', value: 'alice@test.com' },
      { name: 'To', value: 'user@test.com' },
      { name: 'Subject', value: 'Test Subject' },
      { name: 'Date', value: 'Mon, 10 Mar 2026 10:00:00 -0500' },
    ],
  },
};

export const gmailSendResponse = {
  id: 'sent-1',
  threadId: 'thread-new',
  labelIds: ['SENT'],
};

// --- Calendar contract responses ---

export const calendarAgendaResponse = {
  events: [
    { calendar: 'user@test.com', summary: 'Standup', start: '2026-03-14T09:00:00Z', end: '2026-03-14T09:30:00Z' },
  ],
  timeMin: '2026-03-14T00:00:00Z',
  timeMax: '2026-03-14T23:59:59Z',
};

export const calendarEventsListResponse = {
  items: [
    { id: 'evt-1', summary: 'Standup', start: { dateTime: '2026-03-14T09:00:00Z' }, end: { dateTime: '2026-03-14T09:30:00Z' }, status: 'confirmed', attendees: [] },
    { id: 'evt-2', summary: 'Lunch', start: { dateTime: '2026-03-14T12:00:00Z' }, end: { dateTime: '2026-03-14T13:00:00Z' }, status: 'confirmed' },
  ],
};

export const calendarEventDetailResponse = {
  id: 'evt-1',
  summary: 'Standup',
  start: { dateTime: '2026-03-14T09:00:00Z' },
  end: { dateTime: '2026-03-14T09:30:00Z' },
  status: 'confirmed',
  location: 'Room A',
  description: 'Daily standup',
  organizer: { email: 'user@test.com' },
  attendees: [{ email: 'alice@test.com', responseStatus: 'accepted' }],
};

export const calendarInsertResponse = {
  id: 'evt-new',
  summary: 'New Event',
  status: 'confirmed',
  htmlLink: 'https://calendar.google.com/event?eid=xxx',
};

export const calendarFreeBusyResponse = {
  calendars: {
    'user@test.com': {
      busy: [
        { start: '2026-04-09T14:00:00Z', end: '2026-04-09T15:00:00Z' },
        { start: '2026-04-09T16:00:00Z', end: '2026-04-09T16:30:00Z' },
      ],
    },
    'colleague@test.com': {
      busy: [],
    },
  },
};

export const calendarFreeBusyErrorResponse = {
  calendars: {
    'user@test.com': { busy: [] },
    'private@test.com': {
      errors: [{ domain: 'calendar', reason: 'notFound' }],
    },
  },
};

// --- Drive contract responses ---

export const driveFileListResponse = {
  files: [
    { id: 'file-1', name: 'report.pdf', mimeType: 'application/pdf', modifiedTime: '2026-03-14T10:00:00Z', size: '1024', webViewLink: 'https://drive.google.com/file/d/file-1/view' },
    { id: 'file-2', name: 'notes.gdoc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-13T10:00:00Z' },
  ],
};

export const driveFileDetailResponse = {
  id: 'file-1',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  modifiedTime: '2026-03-14T10:00:00Z',
  size: '1024',
  webViewLink: 'https://drive.google.com/file/d/file-1/view',
  owners: [{ emailAddress: 'user@test.com' }],
  shared: false,
};

export const driveUploadResponse = {
  id: 'file-new',
  name: 'uploaded.txt',
  mimeType: 'text/plain',
};
