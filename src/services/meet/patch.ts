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

import { execute } from '../../executor/gws.js';
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
  const transcriptsResult = await execute([
    'meet', 'conferenceRecords', 'transcripts', 'list',
    '--params', JSON.stringify({ parent }),
  ], { account, format: 'json' });

  const transcriptsData = transcriptsResult.data as Record<string, unknown>;
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

  const [entriesResult, participantsResult] = await Promise.all([
    execute([
      'meet', 'conferenceRecords', 'transcripts', 'entries', 'list',
      '--params', JSON.stringify(entriesParams),
    ], { account, format: 'json' }),
    execute([
      'meet', 'conferenceRecords', 'participants', 'list',
      '--params', JSON.stringify({ parent, pageSize: 100 }),
    ], { account, format: 'json' }),
  ]);

  const entriesData = entriesResult.data as Record<string, unknown>;
  const entries = (entriesData?.transcriptEntries ?? []) as Array<Record<string, unknown>>;

  if (entries.length === 0) {
    return {
      text: `Transcript found (${transcriptName}) but no entries available yet. The transcript may still be processing.`,
      refs: { conferenceId: confId, transcriptName, count: 0 },
    };
  }

  // Step 3: Build participant ID → display name map
  const participantsData = participantsResult.data as Record<string, unknown>;
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
 * Prefix a bare conference ID with "conferenceRecords/" in the --params JSON.
 * The Meet API requires full resource names but agents pass bare IDs.
 */
function prefixResourceName(args: string[], paramKey: string, prefix: string): string[] {
  const idx = args.indexOf('--params');
  if (idx === -1 || idx + 1 >= args.length) return args;
  const gwsParams = JSON.parse(args[idx + 1]);
  if (gwsParams[paramKey] && !String(gwsParams[paramKey]).startsWith(prefix)) {
    gwsParams[paramKey] = `${prefix}${gwsParams[paramKey]}`;
    args[idx + 1] = JSON.stringify(gwsParams);
  }
  return args;
}

const prefixConferenceParent = async (args: string[]) =>
  prefixResourceName(args, 'parent', 'conferenceRecords/');

const prefixConferenceName = async (args: string[]) =>
  prefixResourceName(args, 'name', 'conferenceRecords/');

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
  },
};
