/**
 * Meet patch — domain-specific hooks for the Meet service.
 *
 * Key customizations:
 * - Conference list: show meeting codes, start/end times, space names
 * - Participant list: display names with join/leave times
 * - Transcript entries: inline text with participant display names
 * - Custom handler: getFullTranscript chains transcripts.list → entries.list
 *   → participant resolution into a single agent-friendly response
 */

import { call } from '../../google/client.js';
import { requireString } from '../../server/handlers/validate.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

// --- Formatting helpers ---

/** Extract meeting code from a space name like "spaces/abc-mnop-xyz". */
function meetingCode(space: unknown): string {
  if (!space || typeof space !== 'object') return '';
  const name = (space as Record<string, unknown>).meetingCode;
  return name ? String(name) : '';
}

/** Format an ISO timestamp to a short readable form. */
function shortTime(iso: unknown): string {
  if (!iso || typeof iso !== 'string') return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(iso);
  }
}

/** Format duration between two ISO timestamps. */
function duration(startIso: unknown, endIso: unknown): string {
  if (!startIso || !endIso || typeof startIso !== 'string' || typeof endIso !== 'string') return '';
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  } catch {
    return '';
  }
}

/** Extract conference ID from resource name like "conferenceRecords/abc123". */
function conferenceId(name: string): string {
  return name.replace('conferenceRecords/', '');
}

// --- List formatters ---

function formatConferenceList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.conferenceRecords ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No conferences found.', refs: { count: 0 } };
  }

  const lines = items.map(conf => {
    const name = String(conf.name ?? '');
    const id = conferenceId(name);
    const code = meetingCode(conf.space);
    const start = shortTime(conf.startTime);
    const end = shortTime(conf.endTime);
    const dur = duration(conf.startTime, conf.endTime);
    const codePart = code ? ` (${code})` : '';
    const durPart = dur ? ` [${dur}]` : '';
    return `${id}${codePart} | ${start} - ${end}${durPart}`;
  });

  return {
    text: `## Conferences (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      conferenceId: conferenceId(String(items[0]?.name ?? '')),
      conferences: items.map(c => ({
        id: conferenceId(String(c.name ?? '')),
        meetingCode: meetingCode(c.space),
        startTime: c.startTime,
      })),
    },
  };
}

function formatParticipantList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.participants ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No participants found.', refs: { count: 0 } };
  }

  const lines = items.map(p => {
    const signedin = p.signedinUser as Record<string, unknown> | undefined;
    const anon = p.anonymousUser as Record<string, unknown> | undefined;
    const phone = p.phoneUser as Record<string, unknown> | undefined;
    const displayName = signedin?.displayName ?? anon?.displayName ?? phone?.displayName ?? '(unknown)';
    const joinTime = shortTime(p.earliestStartTime);
    const leaveTime = shortTime(p.latestEndTime);
    return `${displayName} | ${joinTime} - ${leaveTime}`;
  });

  return {
    text: `## Participants (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      participants: items.map(p => {
        const signedin = p.signedinUser as Record<string, unknown> | undefined;
        return {
          name: String(signedin?.displayName ?? '(unknown)'),
          user: signedin?.user ? String(signedin.user) : undefined,
        };
      }),
    },
  };
}

function formatTranscriptList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.transcripts ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No transcripts found.', refs: { count: 0 } };
  }

  const lines = items.map(t => {
    const name = String(t.name ?? '');
    const state = String(t.state ?? '');
    const startTime = shortTime(t.startTime);
    const endTime = shortTime(t.endTime);
    const docsUri = (t.docsDestination as Record<string, unknown>)?.exportUri;
    const docsPart = docsUri ? ` | [Docs](${docsUri})` : '';
    return `${name} | ${state} | ${startTime} - ${endTime}${docsPart}`;
  });

  return {
    text: `## Transcripts (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      transcriptName: String(items[0]?.name ?? ''),
      transcripts: items.map(t => ({
        name: t.name,
        state: t.state,
        docsUri: (t.docsDestination as Record<string, unknown>)?.exportUri,
      })),
    },
  };
}

function formatRecordingList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.recordings ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No recordings found.', refs: { count: 0 } };
  }

  const lines = items.map(r => {
    const name = String(r.name ?? '');
    const state = String(r.state ?? '');
    const startTime = shortTime(r.startTime);
    const endTime = shortTime(r.endTime);
    const driveUri = (r.driveDestination as Record<string, unknown>)?.exportUri;
    const drivePart = driveUri ? ` | [Drive](${driveUri})` : '';
    return `${name} | ${state} | ${startTime} - ${endTime}${drivePart}`;
  });

  return {
    text: `## Recordings (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      recordingName: String(items[0]?.name ?? ''),
      recordings: items.map(r => ({
        name: r.name,
        state: r.state,
        driveUri: (r.driveDestination as Record<string, unknown>)?.exportUri,
      })),
    },
  };
}

function formatSmartNoteList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.smartNotes ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No smart notes found.', refs: { count: 0 } };
  }

  const lines = items.map(n => {
    const name = String(n.name ?? '');
    const state = String(n.state ?? '');
    const docsUri = (n.docsDestination as Record<string, unknown>)?.exportUri;
    const docsPart = docsUri ? ` | [Docs](${docsUri})` : '';
    return `${name} | ${state}${docsPart}`;
  });

  return {
    text: `## Smart Notes (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      smartNoteName: String(items[0]?.name ?? ''),
      smartNotes: items.map(n => ({
        name: n.name,
        state: n.state,
        docsUri: (n.docsDestination as Record<string, unknown>)?.exportUri,
      })),
    },
  };
}

// --- Transcript collapsing ---

interface ResolvedEntry {
  participant: string;
  text: string;
  time: string;
}

/**
 * Collapse consecutive entries by the same speaker into blocks.
 * "Alice: Hello" + "Alice: world" → "**Alice** (time):\nHello\nworld"
 */
function collapseEntries(entries: ResolvedEntry[]): string[] {
  const blocks: string[] = [];
  let currentSpeaker = '';
  let currentLines: string[] = [];
  let currentTime = '';

  for (const e of entries) {
    if (e.participant !== currentSpeaker) {
      if (currentSpeaker) {
        blocks.push(`**${currentSpeaker}** (${currentTime}):\n${currentLines.join('\n')}`);
      }
      currentSpeaker = e.participant;
      currentLines = [e.text];
      currentTime = e.time;
    } else {
      currentLines.push(e.text);
    }
  }
  if (currentSpeaker) {
    blocks.push(`**${currentSpeaker}** (${currentTime}):\n${currentLines.join('\n')}`);
  }

  return blocks;
}

// --- Detail formatters ---

function formatTranscriptEntries(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const entries = (raw?.transcriptEntries ?? []) as Array<Record<string, unknown>>;

  if (entries.length === 0) {
    return { text: 'No transcript entries found.', refs: { count: 0 } };
  }

  const resolved = entries.map(e => ({
    participant: String(e.participantDisplayName ?? e.participant ?? ''),
    text: String(e.text ?? ''),
    time: shortTime(e.startTime),
  }));

  const blocks = collapseEntries(resolved);

  return {
    text: `## Transcript (${entries.length} entries)\n\n${blocks.join('\n\n')}`,
    refs: {
      count: entries.length,
      entries: entries.map(e => ({
        participant: e.participantDisplayName ?? e.participant,
        text: e.text,
        startTime: e.startTime,
      })),
    },
  };
}

function formatConferenceDetail(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const name = String(raw.name ?? '');
  const id = conferenceId(name);
  const code = meetingCode(raw.space);
  const start = shortTime(raw.startTime);
  const end = shortTime(raw.endTime);
  const dur = duration(raw.startTime, raw.endTime);

  const parts = [`## Conference ${id}`];
  if (code) parts.push(`**Meeting code:** ${code}`);
  parts.push(`**Time:** ${start} - ${end}`);
  if (dur) parts.push(`**Duration:** ${dur}`);
  if (raw.expireTime) parts.push(`**Expires:** ${shortTime(raw.expireTime)}`);

  return {
    text: parts.join('\n'),
    refs: {
      conferenceId: id,
      meetingCode: code,
      startTime: raw.startTime,
      endTime: raw.endTime,
    },
  };
}

// --- Custom handlers ---

/**
 * getFullTranscript — chains transcripts.list → entries.list → format.
 * Accepts a conferenceId and returns the full who-said-what transcript
 * without requiring the agent to know resource name conventions.
 */
async function getFullTranscript(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const confId = String(params.conferenceId ?? '');
  if (!confId) throw new Error('conferenceId is required for getFullTranscript');

  const parent = confId.startsWith('conferenceRecords/') ? confId : `conferenceRecords/${confId}`;

  // Step 1: List transcripts for this conference
  const transcriptsData = await call(
    'meet',
    'conferenceRecords.transcripts.list',
    { parent },
    { account },
  ) as Record<string, unknown>;
  const transcripts = (transcriptsData?.transcripts ?? []) as Array<Record<string, unknown>>;

  if (transcripts.length === 0) {
    return {
      text: 'No transcripts found for this conference. Transcripts require Workspace Business Standard+ and must be enabled before the meeting.',
      refs: { conferenceId: confId, count: 0 },
    };
  }

  // Step 2: Fetch transcript entries and participants in parallel
  const transcriptName = String(transcripts[0].name ?? '');
  const pageToken = params.pageToken ? String(params.pageToken) : undefined;
  const entriesParams: Record<string, unknown> = { parent: transcriptName, pageSize: 100 };
  if (pageToken) entriesParams.pageToken = pageToken;

  const [entriesData, participantsData] = await Promise.all([
    call('meet', 'conferenceRecords.transcripts.entries.list', entriesParams, { account }),
    call('meet', 'conferenceRecords.participants.list', { parent, pageSize: 100 }, { account }),
  ]) as [Record<string, unknown>, Record<string, unknown>];

  const entries = (entriesData?.transcriptEntries ?? []) as Array<Record<string, unknown>>;

  if (entries.length === 0) {
    return {
      text: `Transcript found (${transcriptName}) but no entries available yet. The transcript may still be processing.`,
      refs: { conferenceId: confId, transcriptName, count: 0 },
    };
  }

  // Step 3: Build participant ID → display name map
  const participants = (participantsData?.participants ?? []) as Array<Record<string, unknown>>;
  const nameMap = new Map<string, string>();
  for (const p of participants) {
    const name = String(p.name ?? '');
    const signedin = p.signedinUser as Record<string, unknown> | undefined;
    const anon = p.anonymousUser as Record<string, unknown> | undefined;
    const phone = p.phoneUser as Record<string, unknown> | undefined;
    const displayName = String(signedin?.displayName ?? anon?.displayName ?? phone?.displayName ?? '');
    if (name && displayName) nameMap.set(name, displayName);
  }

  // Step 4: Format who-said-what with resolved names, collapsed by speaker
  const resolved = entries.map(e => {
    const rawParticipant = String(e.participant ?? '');
    return {
      participant: e.participantDisplayName
        ? String(e.participantDisplayName)
        : nameMap.get(rawParticipant) ?? rawParticipant.split('/').pop() ?? rawParticipant,
      text: String(e.text ?? ''),
      time: shortTime(e.startTime),
    };
  });

  const blocks = collapseEntries(resolved);

  const nextPageToken = entriesData.nextPageToken ? String(entriesData.nextPageToken) : null;
  const docsUri = (transcripts[0].docsDestination as Record<string, unknown>)?.exportUri;

  const isFirstPage = !pageToken;
  const isLastPage = !nextPageToken;

  const footer: string[] = [];
  if (docsUri && (isFirstPage || isLastPage)) {
    footer.push(`\n\n[Full transcript in Google Docs](${docsUri})`);
  }
  if (nextPageToken) {
    footer.push(`\n\n**More entries available.** Continue with: \`manage_meet\` — \`{"operation":"getFullTranscript","email":"${account}","conferenceId":"${confId}","pageToken":"${nextPageToken}"}\``);
  }

  return {
    text: `## Transcript (${entries.length} entries)\n\n${blocks.join('\n\n')}${footer.join('')}`,
    refs: {
      conferenceId: confId,
      transcriptName,
      count: entries.length,
      nextPageToken,
      docsUri: docsUri ?? null,
      entries: entries.map(e => {
        const raw = String(e.participant ?? '');
        return {
          participant: e.participantDisplayName ?? nameMap.get(raw) ?? raw,
          text: e.text,
          startTime: e.startTime,
        };
      }),
    },
  };
}

/**
 * Prefix a bare conference ID with "conferenceRecords/".
 *
 * Meet's API takes full resource names ("conferenceRecords/abc"); agents pass
 * bare IDs. This is OUR opinion, applied in OUR layer — exactly where it belongs.
 *
 * It used to do this by re-serialising an argv slot's JSON. The seam now carries
 * params, so it is a plain object transform (ADR-103).
 *
 * Note these values are precisely the ones that must reach the wire with their
 * slash INTACT: Meet's paths are `{+name}` / `{+parent}`, RFC 6570 reserved
 * expansion, and percent-encoding that `/` 404s every Meet sub-resource call. The
 * client honours the `+`; see src/google/client.ts.
 */
function prefixResourceName(
  params: Record<string, unknown>,
  paramKey: string,
  prefix: string,
): Record<string, unknown> {
  const value = params[paramKey];
  if (!value || String(value).startsWith(prefix)) return params;
  return { ...params, [paramKey]: `${prefix}${value}` };
}

const prefixConferenceParent = async (params: Record<string, unknown>) =>
  prefixResourceName(params, 'parent', 'conferenceRecords/');

const prefixConferenceName = async (params: Record<string, unknown>) =>
  prefixResourceName(params, 'name', 'conferenceRecords/');


// --- Meeting spaces ---

/**
 * Normalize whatever the caller has to the `spaces/...` resource name Google wants.
 *
 * People copy meeting codes out of a Meet link ("abc-mnop-xyz"), out of a calendar entry
 * with the dashes stripped, or paste the whole URL. Google accepts only `spaces/{id}`,
 * and rejects the rest with a 404 that says nothing about which form it wanted.
 */
function spaceName(value: string): string {
  const raw = value.trim();
  if (raw.startsWith('spaces/')) return raw;
  // A full URL: https://meet.google.com/abc-mnop-xyz
  const fromUrl = raw.match(/meet\.google\.com\/([a-z-]+)/i);
  if (fromUrl) return `spaces/${fromUrl[1]}`;
  return `spaces/${raw}`;
}

/** The body Google takes for creating or updating a space's config. */
function spaceConfig(params: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (typeof params.accessType === 'string') config.accessType = params.accessType;
  if (params.moderation !== undefined) {
    config.moderation = params.moderation ? 'MODERATION_ON' : 'MODERATION_OFF';
  }
  return config;
}

/**
 * Render a space so the joinable link is the first thing visible.
 *
 * Google returns `meetingUri` and `meetingCode` alongside a `name` of the form
 * `spaces/xyz`. The name is the handle every other operation takes; the URI is the thing
 * a human is actually asking for. Both, labelled.
 */
function formatSpace(data: Record<string, unknown>, verb: string): HandlerResponse {
  const config = (data.config ?? {}) as Record<string, unknown>;
  const active = (data.activeConference ?? {}) as Record<string, unknown>;
  const access = typeof config.accessType === 'string' ? config.accessType : '(default)';
  const moderation = config.moderation === 'MODERATION_ON' ? 'on' : 'off';

  return {
    text: [
      `${verb}: **${String(data.meetingUri ?? '(no link returned)')}**`,
      '',
      `**Meeting code:** ${String(data.meetingCode ?? '—')}`,
      `**Space:** ${String(data.name ?? '—')}`,
      `**Who can join:** ${access}`,
      `**Host controls:** ${moderation}`,
      active.conferenceRecord
        ? `**In progress now** — conference record \`${String(active.conferenceRecord)}\``
        : '**In progress now:** no',
    ].join('\n'),
    refs: {
      space: data.name,
      meetingCode: data.meetingCode,
      meetingUri: data.meetingUri,
      accessType: config.accessType,
      activeConference: active.conferenceRecord ?? null,
    },
  };
}

/**
 * Create a standalone meeting link.
 *
 * spaces.create declares NO parameters in Discovery, so the generated resource op would
 * send an empty request and every space would come back with default settings — the same
 * silent drop that made documents.create ignore titles. Hence a custom handler.
 */
async function createSpace(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const config = spaceConfig(params);
  const data = await call('meet', 'spaces.create',
    Object.keys(config).length ? { config } : {}, { account }) as Record<string, unknown>;
  return formatSpace(data, 'Meeting created');
}

/** Look up a space by meeting code, link, or resource name. */
async function getSpace(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const name = spaceName(requireString(params, 'space'));
  const data = await call('meet', 'spaces.get', { name }, { account }) as Record<string, unknown>;
  return formatSpace(data, 'Meeting');
}

/**
 * Change a space's settings.
 *
 * `updateMask` is required and must name exactly the fields being changed — omit it and
 * Google returns 200 having applied nothing, which is the failure mode this codebase
 * keeps meeting. The mask is built from what the caller actually supplied.
 */
async function updateSpace(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const name = spaceName(requireString(params, 'space'));
  const config = spaceConfig(params);
  const mask = Object.keys(config).map(k => `config.${k}`);

  if (mask.length === 0) {
    throw new Error('updateSpace needs at least one of: accessType, moderation');
  }

  const data = await call('meet', 'spaces.patch',
    { name, updateMask: mask.join(','), config }, { account }) as Record<string, unknown>;
  return formatSpace(data, 'Meeting updated');
}

/**
 * End the call happening in a space.
 *
 * Google returns an empty body and a 200 whether or not anyone was in the room, so the
 * response cannot claim a meeting was actually ended — only that the request was
 * accepted. Saying "ended the meeting" when nobody was in it would be a small lie of
 * exactly the kind this codebase spends its time removing.
 */
async function endActiveConference(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const name = spaceName(requireString(params, 'space'));
  await call('meet', 'spaces.endActiveConference', { name }, { account });
  return {
    text: `Asked Google to end any call in progress in \`${name}\`.\n\n` +
      `> Google accepts this whether or not anyone was in the room, so this confirms the ` +
      `request, not that a meeting was running. Check with \`getSpace\`.`,
    refs: { space: name, ended: true },
  };
}

/**
 * Conferences happening right now.
 *
 * Google exposes this as conferenceRecords.list with the EBNF filter `end_time IS NULL` —
 * a record without an end time is a call still in progress. Wrapping it means the agent
 * asks for "what is live now" instead of composing filter syntax.
 */
async function activeConferences(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const pageSize = Number(params.maxResults) || 25;
  const data = await call('meet', 'conferenceRecords.list',
    { filter: 'end_time IS NULL', pageSize }, { account }) as Record<string, unknown>;

  const records = (data.conferenceRecords ?? []) as Array<Record<string, unknown>>;
  if (records.length === 0) {
    return { text: 'No conferences are in progress right now.', refs: { count: 0, active: [] } };
  }

  const lines = records.map(r => {
    const code = meetingCode(r.space);
    return `- \`${String(r.name ?? '')}\`${code ? ` — ${code}` : ''} (started ${String(r.startTime ?? '?')})`;
  });

  return {
    text: `## In progress now (${records.length})\n\n${lines.join('\n')}`,
    refs: {
      count: records.length,
      active: records.map(r => ({ conferenceRecord: r.name, startTime: r.startTime })),
    },
  };
}

export const meetPatch: ServicePatch = {
  beforeExecute: {
    listParticipants: prefixConferenceParent,
    listTranscripts: prefixConferenceParent,
    listRecordings: prefixConferenceParent,
    listSmartNotes: prefixConferenceParent,
    getConference: prefixConferenceName,
  },

  formatList: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'listConferences':
        return formatConferenceList(data);
      case 'listParticipants':
        return formatParticipantList(data);
      case 'listTranscripts':
        return formatTranscriptList(data);
      case 'listTranscriptEntries':
        return formatTranscriptEntries(data);
      case 'listRecordings':
        return formatRecordingList(data);
      case 'listSmartNotes':
        return formatSmartNoteList(data);
      default: {
        // Unknown list operation — return generic format rather than
        // silently misformatting as a conference list
        const raw = data as Record<string, unknown>;
        const items = Object.values(raw).find(Array.isArray) as unknown[] ?? [];
        return {
          text: items.length > 0
            ? `## Results (${items.length})\n\n${JSON.stringify(items, null, 2)}`
            : 'No results found.',
          refs: { count: items.length },
        };
      }
    }
  },

  formatDetail: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'getConference':
        return formatConferenceDetail(data);
      default: {
        // For getTranscript, getRecording, getSmartNote — default detail is fine
        // but enrich refs with the resource name for chaining
        const raw = data as Record<string, unknown>;
        const name = String(raw.name ?? '');
        const parts: string[] = [`## ${ctx.operation.replace('get', '')}`];
        for (const [key, val] of Object.entries(raw)) {
          if (val === null || val === undefined || typeof val === 'object') continue;
          parts.push(`**${key}:** ${val}`);
        }
        return {
          text: parts.join('\n'),
          refs: { name, ...raw },
        };
      }
    }
  },

  customHandlers: {
    getFullTranscript,
    createSpace,
    getSpace,
    updateSpace,
    endActiveConference,
    activeConferences,
  },
};
