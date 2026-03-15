/**
 * Response formatters — shape raw gws JSON into token-efficient
 * markdown for AI consumption.
 *
 * Design:
 * - Lists are compact and scannable (pipe-delimited, IDs included)
 * - Detail views are natural prose an agent can relay to a user
 * - Each formatter returns { text, refs } where refs are the
 *   structured values queue $N.field resolution needs
 */

export interface FormattedResponse {
  text: string;
  refs: Record<string, unknown>;
}

// --- Email formatting ---

export function formatEmailList(data: unknown): FormattedResponse {
  const raw = data as Record<string, unknown>;
  const messages = (raw?.messages ?? raw?.items ?? []) as Record<string, unknown>[];

  if (messages.length === 0) {
    return { text: 'No messages found.', refs: { count: 0 } };
  }

  const lines = messages.map(msg => {
    const id = String(msg.id ?? '');
    const from = truncate(String(msg.from ?? ''), 30);
    const subject = truncate(String(msg.subject ?? '(no subject)'), 50);
    const date = formatShortDate(msg.date);
    return `${id} | ${from} | ${subject} | ${date}`;
  });

  const text = `## Messages (${messages.length})\n\n${lines.join('\n')}`;
  const firstId = String(messages[0]?.id ?? '');

  return {
    text,
    refs: {
      count: messages.length,
      messageId: firstId,
      messages: messages.map(m => String(m.id ?? '')),
    },
  };
}

export function formatEmailDetail(data: unknown): FormattedResponse {
  const msg = data as Record<string, unknown>;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;

  const getHeader = (name: string) =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const id = String(msg.id ?? '');
  const from = getHeader('from');
  const to = getHeader('to');
  const subject = getHeader('subject');
  const date = getHeader('date');
  const snippet = String(msg.snippet ?? '');
  const labels = (msg.labelIds ?? []) as string[];

  const parts: string[] = [
    `## ${subject || '(no subject)'}`,
    '',
    `**From:** ${from}`,
    `**To:** ${to}`,
    `**Date:** ${date}`,
  ];

  if (labels.length > 0) {
    parts.push(`**Labels:** ${labels.join(', ')}`);
  }

  parts.push('', snippet);

  return {
    text: parts.join('\n'),
    refs: {
      id,
      threadId: String(msg.threadId ?? ''),
      messageId: id,
      from,
      to,
      subject,
    },
  };
}

// --- Calendar formatting ---

export function formatEventList(data: unknown): FormattedResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.items ?? []) as Record<string, unknown>[];

  if (items.length === 0) {
    return { text: 'No events found.', refs: { count: 0 } };
  }

  const lines = items.map(event => {
    const id = String(event.id ?? '');
    const summary = String(event.summary ?? '(no title)');
    const start = formatEventTime(event.start);
    const end = formatEventTime(event.end);
    const timeRange = formatTimeRange(start, end);
    const location = event.location ? ` | ${event.location}` : '';
    const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0;
    const attendees = attendeeCount > 0 ? ` | ${attendeeCount} attendee${attendeeCount > 1 ? 's' : ''}` : '';
    const marker = eventMarker(start);
    return `${marker} ${timeRange} | ${summary}${location}${attendees} _(${id})_`;
  });

  const text = `## Events (${items.length})\n\n${lines.join('\n')}`;

  return {
    text,
    refs: {
      count: items.length,
      eventId: String(items[0]?.id ?? ''),
      events: items.map(e => String(e.id ?? '')),
    },
  };
}

export function formatEventDetail(data: unknown): FormattedResponse {
  const event = data as Record<string, unknown>;
  const attendees = (event.attendees ?? []) as Array<Record<string, unknown>>;
  const id = String(event.id ?? '');
  const summary = String(event.summary ?? '(no title)');
  const start = formatEventTime(event.start);
  const end = formatEventTime(event.end);
  const location = event.location ? String(event.location) : undefined;
  const description = event.description ? String(event.description) : undefined;
  const organizer = (event.organizer as Record<string, unknown>)?.email as string | undefined;

  const meetLink = (event.conferenceData as Record<string, unknown>)?.entryPoints
    ? ((event.conferenceData as Record<string, unknown>).entryPoints as Array<Record<string, unknown>>)
        .find(e => e.entryPointType === 'video')?.uri as string | undefined
    : undefined;

  const parts: string[] = [
    `## ${summary}`,
    '',
    `**When:** ${formatTimeRange(start, end)}`,
  ];

  if (location) parts.push(`**Where:** ${location}`);
  if (organizer) parts.push(`**Organizer:** ${organizer}`);
  if (meetLink) parts.push(`**Meet:** ${meetLink}`);

  if (attendees.length > 0) {
    parts.push('', '**Attendees:**');
    for (const a of attendees) {
      const status = a.responseStatus === 'accepted' ? '[x]'
                   : a.responseStatus === 'declined' ? '[-]'
                   : '[ ]';
      parts.push(`- ${status} ${a.email}`);
    }
  }

  if (description) {
    parts.push('', description);
  }

  return {
    text: parts.join('\n'),
    refs: {
      id,
      eventId: id,
      summary,
      start,
      end,
      organizer,
      meetLink,
    },
  };
}

// --- Drive formatting ---

export function formatFileList(data: unknown): FormattedResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.files ?? []) as Record<string, unknown>[];

  if (items.length === 0) {
    return { text: 'No files found.', refs: { count: 0 } };
  }

  const lines = items.map(file => {
    const id = String(file.id ?? '');
    const name = truncate(String(file.name ?? ''), 40);
    const type = shortMimeType(String(file.mimeType ?? ''));
    const modified = formatShortDate(file.modifiedTime);
    const size = file.size ? humanSize(Number(file.size)) : '';
    return `${id} | ${name} | ${type} | ${modified}${size ? ' | ' + size : ''}`;
  });

  const text = `## Files (${items.length})\n\n${lines.join('\n')}`;

  return {
    text,
    refs: {
      count: items.length,
      fileId: String(items[0]?.id ?? ''),
      files: items.map(f => String(f.id ?? '')),
    },
  };
}

export function formatFileDetail(data: unknown): FormattedResponse {
  const file = data as Record<string, unknown>;
  const id = String(file.id ?? '');
  const name = String(file.name ?? '');
  const mimeType = String(file.mimeType ?? '');
  const modified = String(file.modifiedTime ?? '');
  const size = file.size ? humanSize(Number(file.size)) : undefined;
  const webViewLink = file.webViewLink ? String(file.webViewLink) : undefined;
  const owners = (file.owners ?? []) as Array<Record<string, unknown>>;
  const shared = Boolean(file.shared);

  const parts: string[] = [
    `## ${name}`,
    '',
    `**Type:** ${mimeType}`,
    `**Modified:** ${modified}`,
  ];

  if (size) parts.push(`**Size:** ${size}`);
  if (webViewLink) parts.push(`**Link:** ${webViewLink}`);
  if (owners.length > 0) {
    parts.push(`**Owner:** ${owners.map(o => o.emailAddress ?? o.displayName).join(', ')}`);
  }
  parts.push(`**Shared:** ${shared ? 'yes' : 'no'}`);

  return {
    text: parts.join('\n'),
    refs: { id, fileId: id, name, mimeType },
  };
}

// --- Helpers ---

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatShortDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

function formatEventTime(time: unknown): string {
  if (!time) return '';
  const t = time as Record<string, string>;
  return t.dateTime ?? t.date ?? '';
}

function formatTimeRange(start: string, end: string): string {
  if (!start) return '';
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    if (isNaN(s.getTime())) return `${start} – ${end}`;

    const sTime = s.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sDate = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    if (!e || isNaN(e.getTime())) return `${sDate} ${sTime}`;

    const eTime = e.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Same day: "Mon, Mar 14 09:00–09:30"
    if (s.toDateString() === e.toDateString()) {
      return `${sDate} ${sTime}–${eTime}`;
    }
    // Different days
    const eDate = e.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${sDate} ${sTime} – ${eDate} ${eTime}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function eventMarker(start: string): string {
  if (!start) return '[ ]';
  try {
    const d = new Date(start);
    if (isNaN(d.getTime())) return '[ ]';
    return d.getTime() < Date.now() ? '[x]' : '[ ]';
  } catch {
    return '[ ]';
  }
}

function shortMimeType(mime: string): string {
  if (mime.startsWith('application/vnd.google-apps.')) {
    return mime.replace('application/vnd.google-apps.', 'g/');
  }
  // "application/pdf" → "pdf", "text/plain" → "text"
  const parts = mime.split('/');
  if (parts.length === 2) {
    return parts[1] === 'octet-stream' ? 'binary' : parts[1];
  }
  return mime;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
