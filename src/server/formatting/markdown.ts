/**
 * Response formatters — shape raw gws JSON into token-efficient
 * structures for AI consumption.
 */

// --- Email formatting ---

export function formatEmailList(data: unknown): { emails: EmailSummary[]; count: number } {
  const raw = data as Record<string, unknown>;
  const messages = (raw?.messages ?? raw?.items ?? []) as Record<string, unknown>[];

  const emails: EmailSummary[] = messages.map(msg => ({
    id: String(msg.id ?? ''),
    threadId: msg.threadId ? String(msg.threadId) : undefined,
    from: msg.from ? String(msg.from) : undefined,
    subject: msg.subject ? String(msg.subject) : undefined,
    date: msg.date ? String(msg.date) : undefined,
    snippet: msg.snippet ? String(msg.snippet) : undefined,
  }));

  return { emails, count: emails.length };
}

export function formatEmailDetail(data: unknown): Record<string, unknown> {
  const msg = data as Record<string, unknown>;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;

  const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader('from'),
    to: getHeader('to'),
    subject: getHeader('subject'),
    date: getHeader('date'),
    snippet: msg.snippet,
    labels: msg.labelIds,
  };
}

interface EmailSummary {
  id: string;
  threadId?: string;
  from?: string;
  subject?: string;
  date?: string;
  snippet?: string;
}

// --- Calendar formatting ---

export function formatEventList(data: unknown): { events: EventSummary[]; count: number } {
  const raw = data as Record<string, unknown>;
  const items = (raw?.items ?? []) as Record<string, unknown>[];

  const events: EventSummary[] = items.map(event => ({
    id: String(event.id ?? ''),
    summary: String(event.summary ?? '(no title)'),
    start: formatEventTime(event.start),
    end: formatEventTime(event.end),
    status: String(event.status ?? ''),
    location: event.location ? String(event.location) : undefined,
    attendeeCount: Array.isArray(event.attendees) ? event.attendees.length : 0,
  }));

  return { events, count: events.length };
}

export function formatEventDetail(data: unknown): Record<string, unknown> {
  const event = data as Record<string, unknown>;
  const attendees = (event.attendees ?? []) as Array<Record<string, unknown>>;

  return {
    id: event.id,
    summary: event.summary,
    start: formatEventTime(event.start),
    end: formatEventTime(event.end),
    status: event.status,
    location: event.location,
    description: event.description,
    organizer: (event.organizer as Record<string, unknown>)?.email,
    attendees: attendees.map(a => ({
      email: a.email,
      response: a.responseStatus,
    })),
    meetLink: (event.conferenceData as Record<string, unknown>)?.entryPoints
      ? ((event.conferenceData as Record<string, unknown>).entryPoints as Array<Record<string, unknown>>)
          .find(e => e.entryPointType === 'video')?.uri
      : undefined,
  };
}

function formatEventTime(time: unknown): string {
  if (!time) return '';
  const t = time as Record<string, string>;
  return t.dateTime ?? t.date ?? '';
}

interface EventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  status: string;
  location?: string;
  attendeeCount: number;
}

// --- Drive formatting ---

export function formatFileList(data: unknown): { files: FileSummary[]; count: number } {
  const raw = data as Record<string, unknown>;
  const items = (raw?.files ?? []) as Record<string, unknown>[];

  const files: FileSummary[] = items.map(file => ({
    id: String(file.id ?? ''),
    name: String(file.name ?? ''),
    mimeType: String(file.mimeType ?? ''),
    modifiedTime: String(file.modifiedTime ?? ''),
    size: file.size ? Number(file.size) : undefined,
    webViewLink: file.webViewLink ? String(file.webViewLink) : undefined,
  }));

  return { files, count: files.length };
}

interface FileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: number;
  webViewLink?: string;
}
