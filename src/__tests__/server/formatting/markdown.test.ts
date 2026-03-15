import { formatEmailList, formatEmailDetail, formatEventList, formatEventDetail, formatFileList } from '../../../server/formatting/markdown.js';

describe('formatEmailList', () => {
  it('extracts fields from triage response', () => {
    const result = formatEmailList({
      messages: [
        { id: 'msg-1', from: 'alice@test.com', subject: 'Hello', date: 'Mon, 10 Mar 2026' },
        { id: 'msg-2', from: 'bob@test.com', subject: 'Meeting' },
      ],
    });
    expect(result.count).toBe(2);
    expect(result.emails[0]).toMatchObject({ id: 'msg-1', from: 'alice@test.com', subject: 'Hello' });
    expect(result.emails[1].date).toBeUndefined();
  });

  it('handles empty messages', () => {
    expect(formatEmailList({}).count).toBe(0);
    expect(formatEmailList({ messages: [] }).count).toBe(0);
  });

  it('falls back to items array', () => {
    const result = formatEmailList({ items: [{ id: 'x' }] });
    expect(result.count).toBe(1);
  });
});

describe('formatEmailDetail', () => {
  it('extracts headers', () => {
    const result = formatEmailDetail({
      id: 'msg-1', threadId: 'thread-1', snippet: 'Preview',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'alice@test.com' },
          { name: 'Subject', value: 'Test' },
          { name: 'Date', value: '2026-03-14' },
        ],
      },
    });
    expect(result.from).toBe('alice@test.com');
    expect(result.subject).toBe('Test');
    expect(result.labels).toEqual(['INBOX']);
  });

  it('handles missing payload', () => {
    const result = formatEmailDetail({ id: 'msg-1' });
    expect(result.from).toBe('');
    expect(result.subject).toBe('');
  });
});

describe('formatEventList', () => {
  it('extracts event summaries', () => {
    const result = formatEventList({
      items: [
        { id: 'evt-1', summary: 'Standup', start: { dateTime: '2026-03-14T09:00:00Z' }, end: { dateTime: '2026-03-14T09:30:00Z' }, status: 'confirmed', attendees: [{}, {}] },
        { id: 'evt-2', summary: 'Lunch', start: { date: '2026-03-14' }, end: { date: '2026-03-14' }, status: 'confirmed' },
      ],
    });
    expect(result.count).toBe(2);
    expect(result.events[0]).toMatchObject({ id: 'evt-1', summary: 'Standup', attendeeCount: 2 });
    expect(result.events[1].start).toBe('2026-03-14');
    expect(result.events[1].attendeeCount).toBe(0);
  });

  it('handles missing title', () => {
    const result = formatEventList({ items: [{ id: 'x', start: {}, end: {} }] });
    expect(result.events[0].summary).toBe('(no title)');
  });

  it('handles empty items', () => {
    expect(formatEventList({}).count).toBe(0);
  });
});

describe('formatEventDetail', () => {
  it('extracts attendees and meet link', () => {
    const result = formatEventDetail({
      id: 'evt-1', summary: 'Meeting',
      start: { dateTime: '2026-03-14T10:00:00Z' },
      end: { dateTime: '2026-03-14T11:00:00Z' },
      organizer: { email: 'org@test.com' },
      attendees: [{ email: 'a@test.com', responseStatus: 'accepted' }],
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xxx' }] },
    });
    expect(result.organizer).toBe('org@test.com');
    expect(result.attendees).toEqual([{ email: 'a@test.com', response: 'accepted' }]);
    expect(result.meetLink).toBe('https://meet.google.com/xxx');
  });

  it('handles missing conference data', () => {
    const result = formatEventDetail({ id: 'x', start: {}, end: {} });
    expect(result.meetLink).toBeUndefined();
  });
});

describe('formatFileList', () => {
  it('extracts file summaries', () => {
    const result = formatFileList({
      files: [
        { id: 'f-1', name: 'report.pdf', mimeType: 'application/pdf', modifiedTime: '2026-03-14', size: '1024', webViewLink: 'https://...' },
        { id: 'f-2', name: 'notes.gdoc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-13' },
      ],
    });
    expect(result.count).toBe(2);
    expect(result.files[0]).toMatchObject({ id: 'f-1', name: 'report.pdf', size: 1024 });
    expect(result.files[1].size).toBeUndefined();
  });

  it('handles empty files', () => {
    expect(formatFileList({}).count).toBe(0);
    expect(formatFileList({ files: [] }).count).toBe(0);
  });
});
