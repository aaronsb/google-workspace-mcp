import {
  formatEmailList, formatEmailDetail,
  formatEventList, formatEventDetail,
  formatFileList, formatFileDetail,
} from '../../../server/formatting/markdown.js';

describe('formatEmailList', () => {
  it('formats triage response as markdown with pipe-delimited rows', () => {
    const result = formatEmailList({
      messages: [
        { id: 'msg-1', from: 'alice@test.com', subject: 'Hello', date: 'Mon, 10 Mar 2026' },
        { id: 'msg-2', from: 'bob@test.com', subject: 'Meeting' },
      ],
    });
    expect(result.text).toContain('## Messages (2)');
    expect(result.text).toContain('msg-1 | alice@test.com | Hello');
    expect(result.text).toContain('msg-2 | bob@test.com | Meeting');
    expect(result.refs.count).toBe(2);
    expect(result.refs.messageId).toBe('msg-1');
  });

  it('handles empty messages with valid API response', () => {
    const result = formatEmailList({ messages: [], resultSizeEstimate: 0, query: 'from:nobody' });
    expect(result.text).toBe('No messages found for query: "from:nobody".');
    expect(result.refs.count).toBe(0);
    expect(result.refs.apiResponseValid).toBe(true);
  });

  it('flags suspicious empty response missing expected fields', () => {
    const result = formatEmailList({});
    expect(result.text).toContain('authentication or scope issue');
    expect(result.refs.apiResponseValid).toBe(false);
  });

  it('handles valid empty response without query', () => {
    const result = formatEmailList({ messages: [], resultSizeEstimate: 0 });
    expect(result.text).toBe('No messages found.');
    expect(result.refs.apiResponseValid).toBe(true);
  });

  it('falls back to items array', () => {
    const result = formatEmailList({ items: [{ id: 'x', from: 'a@b.com', subject: 'Hi' }] });
    expect(result.refs.count).toBe(1);
    expect(result.text).toContain('x |');
  });

  it('provides message IDs array in refs', () => {
    const result = formatEmailList({
      messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    expect(result.refs.messages).toEqual(['a', 'b', 'c']);
  });
});

describe('formatEmailDetail', () => {
  it('formats as prose with headers', () => {
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
    expect(result.text).toContain('## Test');
    expect(result.text).toContain('**From:** alice@test.com');
    expect(result.text).toContain('**Labels:** INBOX');
    expect(result.text).toContain('Preview');
    expect(result.refs.from).toBe('alice@test.com');
    expect(result.refs.subject).toBe('Test');
    expect(result.refs.id).toBe('msg-1');
  });

  it('handles missing payload', () => {
    const result = formatEmailDetail({ id: 'msg-1' });
    expect(result.text).toContain('**From:**');
    expect(result.refs.from).toBe('');
  });

  it('extracts full body from text/plain payload part', () => {
    const fullText = 'Hello Aaron, your invoice has been approved. Please include your Tax ID on future invoices.';
    const base64Body = Buffer.from(fullText).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = formatEmailDetail({
      id: 'msg-2', threadId: 'thread-2', snippet: 'Hello Aaron, your invoice has been',
      payload: {
        headers: [{ name: 'From', value: 'val@jvl.ca' }, { name: 'Subject', value: 'Invoice' }],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: base64Body, size: fullText.length } },
          { mimeType: 'text/html', body: { data: base64Body, size: fullText.length } },
        ],
      },
    });
    expect(result.text).toContain('Tax ID on future invoices');
    expect(result.text).not.toContain('Showing snippet only');
    expect(result.refs.bodyTruncated).toBe(false);
  });

  it('falls back to snippet when payload has no body data', () => {
    const result = formatEmailDetail({
      id: 'msg-3', snippet: 'Snippet fallback',
      payload: {
        headers: [{ name: 'From', value: 'a@b.com' }],
      },
    });
    expect(result.text).toContain('Snippet fallback');
  });

  it('shows snippet with size hint for very large bodies', () => {
    // Generate a body larger than 12k tokens (~48KB+)
    const largeText = 'x'.repeat(60_000);
    const base64Body = Buffer.from(largeText).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = formatEmailDetail({
      id: 'msg-4', snippet: 'This is the snippet',
      payload: {
        headers: [{ name: 'From', value: 'a@b.com' }],
        body: { data: base64Body, size: largeText.length },
      },
    });
    expect(result.text).toContain('This is the snippet');
    expect(result.text).toContain('Showing snippet only');
    expect(result.text).toContain('tokens');
    expect(result.refs.bodyTruncated).toBe(true);
    expect(result.refs.fullBodyTokens).toBeGreaterThan(12_000);
  });
});

describe('formatEventList', () => {
  it('formats events with markers and pipe-delimited fields', () => {
    const result = formatEventList({
      items: [
        { id: 'evt-1', summary: 'Standup', start: { dateTime: '2026-03-14T09:00:00Z' }, end: { dateTime: '2026-03-14T09:30:00Z' }, status: 'confirmed', attendees: [{}, {}] },
        { id: 'evt-2', summary: 'Lunch', start: { date: '2026-03-14' }, end: { date: '2026-03-14' }, status: 'confirmed' },
      ],
    });
    expect(result.text).toContain('## Events (2)');
    expect(result.text).toContain('Standup');
    expect(result.text).toContain('2 attendees');
    expect(result.text).toContain('_(evt-1)_');
    expect(result.refs.count).toBe(2);
    expect(result.refs.eventId).toBe('evt-1');
  });

  it('handles missing title', () => {
    const result = formatEventList({ items: [{ id: 'x', start: {}, end: {} }] });
    expect(result.text).toContain('(no title)');
  });

  it('handles empty items', () => {
    expect(formatEventList({}).text).toBe('No events found.');
    expect(formatEventList({}).refs.count).toBe(0);
  });
});

describe('formatEventDetail', () => {
  it('formats as prose with attendees and meet link', () => {
    const result = formatEventDetail({
      id: 'evt-1', summary: 'Meeting',
      start: { dateTime: '2026-03-14T10:00:00Z' },
      end: { dateTime: '2026-03-14T11:00:00Z' },
      organizer: { email: 'org@test.com' },
      attendees: [{ email: 'a@test.com', responseStatus: 'accepted' }],
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xxx' }] },
    });
    expect(result.text).toContain('## Meeting');
    expect(result.text).toContain('**Organizer:** org@test.com');
    expect(result.text).toContain('[x] a@test.com');
    expect(result.text).toContain('https://meet.google.com/xxx');
    expect(result.refs.organizer).toBe('org@test.com');
    expect(result.refs.meetLink).toBe('https://meet.google.com/xxx');
  });

  it('handles missing conference data', () => {
    const result = formatEventDetail({ id: 'x', start: {}, end: {} });
    expect(result.refs.meetLink).toBeUndefined();
  });

  it('shows declined attendees with [-] marker', () => {
    const result = formatEventDetail({
      id: 'x', start: {}, end: {},
      attendees: [{ email: 'dec@test.com', responseStatus: 'declined' }],
    });
    expect(result.text).toContain('[-] dec@test.com');
  });
});

describe('formatFileList', () => {
  it('formats files with pipe-delimited rows', () => {
    const result = formatFileList({
      files: [
        { id: 'f-1', name: 'report.pdf', mimeType: 'application/pdf', modifiedTime: '2026-03-14', size: '1024', webViewLink: 'https://...' },
        { id: 'f-2', name: 'notes.gdoc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-13' },
      ],
    });
    expect(result.text).toContain('## Files (2)');
    expect(result.text).toContain('report.pdf');
    expect(result.text).toContain('pdf');
    expect(result.text).toContain('g/document');
    expect(result.refs.count).toBe(2);
    expect(result.refs.fileId).toBe('f-1');
  });

  it('handles empty files', () => {
    expect(formatFileList({}).text).toBe('No files found.');
    expect(formatFileList({ files: [] }).text).toBe('No files found.');
  });
});

describe('formatFileDetail', () => {
  it('formats as prose with metadata', () => {
    const result = formatFileDetail({
      id: 'f-1', name: 'report.pdf', mimeType: 'application/pdf',
      modifiedTime: '2026-03-14T10:00:00Z', size: '1048576',
      webViewLink: 'https://drive.google.com/file/d/f-1/view',
      owners: [{ emailAddress: 'user@test.com' }],
      shared: false,
    });
    expect(result.text).toContain('## report.pdf');
    expect(result.text).toContain('**Size:** 1.0 MB');
    expect(result.text).toContain('**Owner:** user@test.com');
    expect(result.text).toContain('**Shared:** no');
    expect(result.refs.fileId).toBe('f-1');
  });
});
