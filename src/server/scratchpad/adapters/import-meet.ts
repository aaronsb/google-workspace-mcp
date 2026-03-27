/**
 * Import adapter: meet — loads a Meet conference transcript into a scratchpad.
 * Imports as markdown with speaker attribution. No live binding (transcripts are read-only).
 */

import { execute } from '../../../executor/gws.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface MeetImportParams {
  email: string;
  conferenceId: string;
}

export async function importMeet(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: MeetImportParams,
): Promise<HandlerResponse> {
  const { email, conferenceId } = sourceParams;
  if (!email || !conferenceId) {
    return { text: 'email and conferenceId are required for meet import.', refs: { error: true } };
  }

  try {
    const parent = conferenceId.startsWith('conferenceRecords/')
      ? conferenceId
      : `conferenceRecords/${conferenceId}`;

    // Step 1: List transcripts
    const transcriptsResult = await execute([
      'meet', 'conferenceRecords', 'transcripts', 'list',
      '--params', JSON.stringify({ parent }),
    ], { account: email, format: 'json' });

    const transcriptsData = transcriptsResult.data as Record<string, unknown>;
    const transcripts = (transcriptsData?.transcripts ?? []) as Array<Record<string, unknown>>;

    if (transcripts.length === 0) {
      return {
        text: `No transcripts found for conference ${conferenceId}.\nScratchpad ${scratchpadId} unchanged.`,
        refs: { scratchpadId, conferenceId },
      };
    }

    // Step 2: Fetch entries and participants in parallel
    const transcriptName = String(transcripts[0].name ?? '');
    const [entriesResult, participantsResult] = await Promise.all([
      execute([
        'meet', 'conferenceRecords', 'transcripts', 'entries', 'list',
        '--params', JSON.stringify({ parent: transcriptName, pageSize: 100 }),
      ], { account: email, format: 'json' }),
      execute([
        'meet', 'conferenceRecords', 'participants', 'list',
        '--params', JSON.stringify({ parent, pageSize: 100 }),
      ], { account: email, format: 'json' }),
    ]);

    const entriesData = entriesResult.data as Record<string, unknown>;
    const entries = (entriesData?.transcriptEntries ?? []) as Array<Record<string, unknown>>;

    if (entries.length === 0) {
      return {
        text: `Transcript found but no entries available yet (may still be processing).\nScratchpad ${scratchpadId} unchanged.`,
        refs: { scratchpadId, conferenceId, transcriptName },
      };
    }

    // Step 3: Build participant lookup
    const participantsData = participantsResult.data as Record<string, unknown>;
    const participants = (participantsData?.participants ?? []) as Array<Record<string, unknown>>;
    const nameMap = new Map<string, string>();
    for (const p of participants) {
      const name = String(p.name ?? '');
      const signedinUser = p.signedinUser as Record<string, unknown> | undefined;
      const displayName = String(signedinUser?.displayName ?? p.name ?? 'Unknown');
      if (name) nameMap.set(name, displayName);
    }

    // Step 4: Format as markdown transcript
    const lines: string[] = [
      `# Meeting Transcript`,
      ``,
      `**Conference:** ${conferenceId}`,
      `**Entries:** ${entries.length}`,
      ``,
    ];

    let currentSpeaker = '';
    for (const entry of entries) {
      const participantName = String(entry.participant ?? '');
      const speaker = nameMap.get(participantName) ?? String(entry.participantDisplayName ?? participantName);
      const text = String(entry.text ?? '');
      const time = formatTime(entry.startTime);

      if (speaker !== currentSpeaker) {
        if (currentSpeaker) lines.push('');
        lines.push(`**${speaker}** (${time}):`);
        currentSpeaker = speaker;
      }
      lines.push(text);
    }

    scratchpads.appendRawLines(scratchpadId, lines);
    scratchpads.setFormat(scratchpadId, 'markdown');
    // No live binding — transcripts are read-only

    return {
      text: `Imported transcript (${entries.length} entries, ${lines.length} lines) into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, conferenceId, entries: entries.length, linesImported: lines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}

function formatTime(time: unknown): string {
  if (!time) return '';
  const s = String(time);
  try {
    const d = new Date(s);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}
