/**
 * Meet patch tests — formatters and custom handlers.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

// getFullTranscript chains three RESOURCE calls, so it goes through the Google
// API client we own (ADR-103). A mocked `call()` resolves to raw Google JSON —
// there is no { success, data, stderr } envelope to build.
vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
const mockCall = call as MockedFunction<typeof call>;

import { meetPatch } from '../../../services/meet/patch.js';
import { loadDescriptor } from '../../../google/descriptor.js';
import type { PatchContext } from '../../../factory/types.js';

function ctx(operation: string, params: Record<string, unknown> = {}): PatchContext {
  return { operation, params, account: 'user@test.com' };
}

describe('Meet patch formatters', () => {
  describe('formatList', () => {
    it('formats conference list with meeting codes and times', () => {
      const data = {
        conferenceRecords: [
          {
            name: 'conferenceRecords/abc123',
            space: { meetingCode: 'abc-mnop-xyz' },
            startTime: '2026-03-18T14:00:00Z',
            endTime: '2026-03-18T15:00:00Z',
          },
          {
            name: 'conferenceRecords/def456',
            space: { meetingCode: 'def-ghij-klm' },
            startTime: '2026-03-17T10:00:00Z',
            endTime: '2026-03-17T10:30:00Z',
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listConferences'));
      expect(result.text).toContain('Conferences (2)');
      expect(result.text).toContain('abc-mnop-xyz');
      expect(result.text).toContain('def-ghij-klm');
      expect(result.text).toContain('1h');
      expect(result.text).toContain('30m');
      expect(result.refs.count).toBe(2);
      expect(result.refs.conferenceId).toBe('abc123');
    });

    it('handles empty conference list', () => {
      const result = meetPatch.formatList!({ conferenceRecords: [] }, ctx('listConferences'));
      expect(result.text).toContain('No conferences found');
      expect(result.refs.count).toBe(0);
    });

    it('formats participant list with display names', () => {
      const data = {
        participants: [
          {
            signedinUser: { displayName: 'Alice Smith', user: 'users/alice@test.com' },
            earliestStartTime: '2026-03-18T14:00:00Z',
            latestEndTime: '2026-03-18T15:00:00Z',
          },
          {
            anonymousUser: { displayName: 'Anonymous Panda' },
            earliestStartTime: '2026-03-18T14:05:00Z',
            latestEndTime: '2026-03-18T14:45:00Z',
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listParticipants'));
      expect(result.text).toContain('Participants (2)');
      expect(result.text).toContain('Alice Smith');
      expect(result.text).toContain('Anonymous Panda');
      expect(result.refs.count).toBe(2);
    });

    it('handles empty participant list', () => {
      const result = meetPatch.formatList!({ participants: [] }, ctx('listParticipants'));
      expect(result.text).toContain('No participants found');
    });

    it('formats transcript list', () => {
      const data = {
        transcripts: [
          {
            name: 'conferenceRecords/abc123/transcripts/t1',
            state: 'ENDED',
            startTime: '2026-03-18T14:00:00Z',
            endTime: '2026-03-18T15:00:00Z',
            docsDestination: { exportUri: 'https://docs.google.com/doc/abc' },
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listTranscripts'));
      expect(result.text).toContain('Transcripts (1)');
      expect(result.text).toContain('ENDED');
      expect(result.text).toContain('Docs');
      expect(result.refs.transcriptName).toContain('transcripts/t1');
    });

    it('formats transcript entries with who-said-what collapsed by speaker', () => {
      const data = {
        transcriptEntries: [
          { participantDisplayName: 'Alice Smith', text: 'Hello everyone', startTime: '2026-03-18T14:01:00Z' },
          { participantDisplayName: 'Alice Smith', text: 'Lets get started', startTime: '2026-03-18T14:01:05Z' },
          { participantDisplayName: 'Bob Jones', text: 'Hi Alice', startTime: '2026-03-18T14:01:30Z' },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listTranscriptEntries'));
      expect(result.text).toContain('Transcript (3 entries)');
      // Alice's lines should be collapsed into one block
      expect(result.text).toContain('**Alice Smith**');
      expect(result.text).toContain('Hello everyone\nLets get started');
      expect(result.text).toContain('**Bob Jones**');
      expect(result.refs.count).toBe(3);
    });

    it('formats recording list', () => {
      const data = {
        recordings: [
          {
            name: 'conferenceRecords/abc123/recordings/r1',
            state: 'FILE_GENERATED',
            startTime: '2026-03-18T14:00:00Z',
            endTime: '2026-03-18T15:00:00Z',
            driveDestination: { exportUri: 'https://drive.google.com/file/abc' },
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listRecordings'));
      expect(result.text).toContain('Recordings (1)');
      expect(result.text).toContain('FILE_GENERATED');
      expect(result.text).toContain('Drive');
      expect(result.refs.recordingName).toContain('recordings/r1');
    });

    it('formats smart notes list', () => {
      const data = {
        smartNotes: [
          {
            name: 'conferenceRecords/abc123/smartNotes/sn1',
            state: 'ENDED',
            docsDestination: { exportUri: 'https://docs.google.com/doc/sn1' },
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listSmartNotes'));
      expect(result.text).toContain('Smart Notes (1)');
      expect(result.text).toContain('Docs');
      expect(result.refs.smartNoteName).toContain('smartNotes/sn1');
    });
  });

  describe('formatDetail', () => {
    it('formats conference detail with meeting code and duration', () => {
      const data = {
        name: 'conferenceRecords/abc123',
        space: { meetingCode: 'abc-mnop-xyz' },
        startTime: '2026-03-18T14:00:00Z',
        endTime: '2026-03-18T15:30:00Z',
        expireTime: '2026-03-25T15:30:00Z',
      };

      const result = meetPatch.formatDetail!(data, ctx('getConference'));
      expect(result.text).toContain('Conference abc123');
      expect(result.text).toContain('abc-mnop-xyz');
      expect(result.text).toContain('1h 30m');
      expect(result.refs.conferenceId).toBe('abc123');
      expect(result.refs.meetingCode).toBe('abc-mnop-xyz');
    });

    it('formats other detail types with generic key/value', () => {
      const data = {
        name: 'conferenceRecords/abc123/recordings/r1',
        state: 'FILE_GENERATED',
      };

      const result = meetPatch.formatDetail!(data, ctx('getRecording'));
      expect(result.text).toContain('Recording');
      expect(result.text).toContain('FILE_GENERATED');
      expect(result.refs.name).toContain('recordings/r1');
    });
  });
});

describe('Meet beforeExecute hooks', () => {
  // The hooks take the params themselves (ADR-103), so these assert the params
  // Google is actually sent.

  it('prefixes conferenceRecords/ on bare parent IDs', async () => {
    const hook = meetPatch.beforeExecute!.listParticipants;
    const result = await hook(
      { parent: 'abc123', pageSize: 100 },
      ctx('listParticipants', { conferenceId: 'abc123' }),
    );
    expect(result.parent).toBe('conferenceRecords/abc123');
    expect(result.pageSize).toBe(100);        // untouched params survive
  });

  it('does not double-prefix already-prefixed parent IDs', async () => {
    const hook = meetPatch.beforeExecute!.listTranscripts;
    const result = await hook(
      { parent: 'conferenceRecords/abc123' },
      ctx('listTranscripts', { conferenceId: 'conferenceRecords/abc123' }),
    );
    expect(result.parent).toBe('conferenceRecords/abc123');
  });

  it('prefixes conferenceRecords/ on bare name IDs for getConference', async () => {
    const hook = meetPatch.beforeExecute!.getConference;
    const result = await hook({ name: 'abc123' }, ctx('getConference', { conferenceId: 'abc123' }));
    expect(result.name).toBe('conferenceRecords/abc123');
  });

  it('leaves params alone when the key is absent', async () => {
    const hook = meetPatch.beforeExecute!.listRecordings;
    const result = await hook({ pageSize: 10 }, ctx('listRecordings'));
    expect(result).toEqual({ pageSize: 10 });
  });
});

describe('Meet custom handlers', () => {
  beforeEach(() => mockCall.mockReset());

  describe('getFullTranscript', () => {
    it('chains transcripts.list, entries.list, and participants.list to resolve names', async () => {
      // Step 1: transcripts.list
      mockCall.mockResolvedValueOnce({
        transcripts: [{
          name: 'conferenceRecords/abc123/transcripts/t1',
          docsDestination: { exportUri: 'https://docs.google.com/doc/abc' },
        }],
      });
      // Step 2 (parallel): entries.list
      mockCall.mockResolvedValueOnce({
        transcriptEntries: [
          { participant: 'conferenceRecords/abc123/participants/111', text: 'Hello', startTime: '2026-03-18T14:01:00Z' },
          { participant: 'conferenceRecords/abc123/participants/222', text: 'Hi there', startTime: '2026-03-18T14:01:30Z' },
        ],
      });
      // Step 2 (parallel): participants.list
      mockCall.mockResolvedValueOnce({
        participants: [
          { name: 'conferenceRecords/abc123/participants/111', signedinUser: { displayName: 'Alice Smith' } },
          { name: 'conferenceRecords/abc123/participants/222', signedinUser: { displayName: 'Bob Jones' } },
        ],
      });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      const result = await handler(
        { conferenceId: 'abc123', email: 'user@test.com' },
        'user@test.com',
      );

      expect(result.text).toContain('Transcript (2 entries)');
      expect(result.text).toContain('**Alice Smith**');
      expect(result.text).toContain('Hello');
      expect(result.text).toContain('**Bob Jones**');
      expect(result.text).toContain('Hi there');
      expect(result.text).toContain('Google Docs');
      expect(result.refs.conferenceId).toBe('abc123');
      expect(result.refs.count).toBe(2);

      // No nextPageToken = last page, so Docs link shown
      expect(result.refs.nextPageToken).toBeNull();

      // Verify the chained calls (3 total: transcripts, then entries + participants in parallel)
      expect(mockCall).toHaveBeenCalledTimes(3);
      expect(mockCall).toHaveBeenNthCalledWith(
        1, 'meet', 'conferenceRecords.transcripts.list',
        { parent: 'conferenceRecords/abc123' },
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(mockCall).toHaveBeenNthCalledWith(
        2, 'meet', 'conferenceRecords.transcripts.entries.list',
        { parent: 'conferenceRecords/abc123/transcripts/t1', pageSize: 100 },
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(mockCall).toHaveBeenNthCalledWith(
        3, 'meet', 'conferenceRecords.participants.list',
        { parent: 'conferenceRecords/abc123', pageSize: 100 },
        expect.objectContaining({ account: 'user@test.com' }),
      );
    });

    it('paginates with nextPageToken and shows continue prompt', async () => {
      mockCall.mockResolvedValueOnce({
        transcripts: [{
          name: 'conferenceRecords/abc123/transcripts/t1',
          docsDestination: { exportUri: 'https://docs.google.com/doc/abc' },
        }],
      });
      mockCall.mockResolvedValueOnce({
        transcriptEntries: [
          { participant: 'conferenceRecords/abc123/participants/111', text: 'Page one', startTime: '2026-03-18T14:01:00Z' },
        ],
        nextPageToken: 'tok_page2',
      });
      mockCall.mockResolvedValueOnce({
        participants: [
          { name: 'conferenceRecords/abc123/participants/111', signedinUser: { displayName: 'Alice' } },
        ],
      });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      const result = await handler(
        { conferenceId: 'abc123', email: 'user@test.com' },
        'user@test.com',
      );

      // First page: shows Docs link + continue prompt
      expect(result.text).toContain('Google Docs');
      expect(result.text).toContain('More entries available');
      expect(result.text).toContain('tok_page2');
      expect(result.refs.nextPageToken).toBe('tok_page2');
    });

    it('passes pageToken to entries API when continuing', async () => {
      mockCall.mockResolvedValueOnce({
        transcripts: [{
          name: 'conferenceRecords/abc123/transcripts/t1',
          docsDestination: { exportUri: 'https://docs.google.com/doc/abc' },
        }],
      });
      mockCall.mockResolvedValueOnce({
        transcriptEntries: [
          { participant: 'conferenceRecords/abc123/participants/111', text: 'Last page', startTime: '2026-03-18T14:10:00Z' },
        ],
      });
      mockCall.mockResolvedValueOnce({
        participants: [
          { name: 'conferenceRecords/abc123/participants/111', signedinUser: { displayName: 'Alice' } },
        ],
      });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      const result = await handler(
        { conferenceId: 'abc123', email: 'user@test.com', pageToken: 'tok_page2' },
        'user@test.com',
      );

      // Verify pageToken was passed to the entries call
      expect(mockCall.mock.calls[1][1]).toBe('conferenceRecords.transcripts.entries.list');
      expect(mockCall.mock.calls[1][2].pageToken).toBe('tok_page2');

      // Last page (no nextPageToken): shows Docs link, no continue prompt
      expect(result.text).toContain('Google Docs');
      expect(result.text).not.toContain('More entries available');
      expect(result.refs.nextPageToken).toBeNull();
    });

    it('returns helpful message when no transcripts exist', async () => {
      mockCall.mockResolvedValueOnce({ transcripts: [] });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      const result = await handler(
        { conferenceId: 'abc123', email: 'user@test.com' },
        'user@test.com',
      );

      expect(result.text).toContain('No transcripts found');
      expect(result.text).toContain('Business Standard');
      expect(result.refs.count).toBe(0);
    });

    it('handles transcript with no entries yet', async () => {
      mockCall.mockResolvedValueOnce({
        transcripts: [{ name: 'conferenceRecords/abc123/transcripts/t1' }],
      });
      // entries.list (parallel)
      mockCall.mockResolvedValueOnce({ transcriptEntries: [] });
      // participants.list (parallel)
      mockCall.mockResolvedValueOnce({ participants: [] });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      const result = await handler(
        { conferenceId: 'abc123', email: 'user@test.com' },
        'user@test.com',
      );

      expect(result.text).toContain('no entries available');
      expect(result.text).toContain('processing');
    });

    it('throws when conferenceId is missing', async () => {
      const handler = meetPatch.customHandlers!.getFullTranscript;
      await expect(handler({}, 'user@test.com')).rejects.toThrow('conferenceId is required');
    });

    it('handles conferenceId with or without prefix', async () => {
      // With prefix
      mockCall.mockResolvedValueOnce({ transcripts: [] });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      await handler(
        { conferenceId: 'conferenceRecords/abc123', email: 'user@test.com' },
        'user@test.com',
      );

      // Not double-prefixed.
      expect(mockCall.mock.calls[0][2].parent).toBe('conferenceRecords/abc123');
    });
  });
});

/**
 * Meeting spaces — the write half of manage_meet, and the first operations in this tool
 * that need `meetings.space.created` rather than `meetings.space.readonly` (ADR-202).
 *
 * Each of these exists because Google asks for something the agent should not have to
 * know: a resource-name format, an enum where a boolean reads better, a field mask, or
 * an EBNF filter.
 */
describe('meetPatch — meeting spaces', () => {
  const H = meetPatch.customHandlers!;
  const ACCOUNT = 'user@test.com';

  beforeEach(() => mockCall.mockReset());

  const space = {
    name: 'spaces/abc123',
    meetingUri: 'https://meet.google.com/abc-mnop-xyz',
    meetingCode: 'abc-mnop-xyz',
    config: { accessType: 'TRUSTED', moderation: 'OFF' },
  };

  describe('createSpace', () => {
    it('leads with the joinable link', async () => {
      mockCall.mockResolvedValue(space);
      const result = await H.createSpace({}, ACCOUNT);

      expect(result.text).toContain('https://meet.google.com/abc-mnop-xyz');
      expect(result.refs.meetingUri).toBe('https://meet.google.com/abc-mnop-xyz');
      // The resource name is the handle every other operation takes, so it rides along.
      expect(result.refs.space).toBe('spaces/abc123');
    });

    it('sends no config when the caller asked for nothing', async () => {
      mockCall.mockResolvedValue(space);
      await H.createSpace({}, ACCOUNT);
      expect(mockCall.mock.calls[0][2]).toEqual({});
    });

    it('turns a moderation boolean into the enum Google wants — ON, not MODERATION_ON', async () => {
      mockCall.mockResolvedValue(space);
      await H.createSpace({ accessType: 'RESTRICTED', moderation: true }, ACCOUNT);

      expect(mockCall.mock.calls[0][2]).toEqual({
        config: { accessType: 'RESTRICTED', moderation: 'ON' },
      });
    });

    it('sends OFF for false rather than dropping the field', async () => {
      mockCall.mockResolvedValue(space);
      await H.createSpace({ moderation: false }, ACCOUNT);
      expect(mockCall.mock.calls[0][2]).toEqual({ config: { moderation: 'OFF' } });
    });

    it('sends only values Google declares for SpaceConfig', async () => {
      // The check that would have caught the real bug. `moderation` is a boolean on this
      // tool and an enum on the wire, so its values live in handler code where no schema
      // sees them — MODERATION_ON passed lint, type-check and this whole suite, and was
      // rejected by Google on the first live call.
      //
      // Read from the descriptor rather than restated, so a value Google retires fails
      // here on the next regeneration instead of in production.
      const svc = (await loadDescriptor()).services.meet;
      const allowedModeration = svc.enums?.['SpaceConfig.moderation'] ?? [];
      const allowedAccess = svc.enums?.['SpaceConfig.accessType'] ?? [];
      expect(allowedModeration.length).toBeGreaterThan(0);

      for (const moderation of [true, false]) {
        mockCall.mockReset();
        mockCall.mockResolvedValue(space);
        await H.createSpace({ moderation, accessType: 'TRUSTED' }, ACCOUNT);

        const config = (mockCall.mock.calls[0][2] as { config: Record<string, string> }).config;
        expect(allowedModeration).toContain(config.moderation);
        expect(allowedAccess).toContain(config.accessType);
      }
    });
  });

  describe('getSpace', () => {
    it.each([
      ['a bare meeting code', 'abc-mnop-xyz'],
      ['a full resource name', 'spaces/abc-mnop-xyz'],
      ['a pasted Meet link', 'https://meet.google.com/abc-mnop-xyz'],
      ['a link with a trailing query', 'https://meet.google.com/abc-mnop-xyz?authuser=1'],
      ['an uppercase prefix', 'Spaces/abc-mnop-xyz'],
    ])('accepts %s', async (_label, input) => {
      // Google takes only `spaces/{id}` and 404s the rest without saying which form it
      // wanted. People copy whichever one is in front of them.
      mockCall.mockResolvedValue(space);
      await H.getSpace({ space: input }, ACCOUNT);
      expect(mockCall.mock.calls[0][2]).toEqual({ name: 'spaces/abc-mnop-xyz' });
    });

    it('reads the moderation enum back correctly, both ways', async () => {
      // The formatter had the SAME wrong enum as the request path, so a space created
      // with host controls ON reported "off". Fixing the request and leaving the
      // formatter is a defect the shared fixture could not show, because it only ever
      // carried one value.
      mockCall.mockResolvedValue({ ...space, config: { accessType: 'TRUSTED', moderation: 'ON' } });
      const on = await H.getSpace({ space: 'abc-mnop-xyz' }, ACCOUNT);
      expect(on.text).toContain('**Host controls:** on');

      mockCall.mockResolvedValue({ ...space, config: { accessType: 'TRUSTED', moderation: 'OFF' } });
      const off = await H.getSpace({ space: 'abc-mnop-xyz' }, ACCOUNT);
      expect(off.text).toContain('**Host controls:** off');
    });

    it('does not turn a nickname URL into a confidently wrong space', async () => {
      // https://meet.google.com/lookup/team-standup is a nickname link. Matching
      // "letters and dashes" made it `spaces/lookup` — a real space id, belonging to
      // nobody, which Google answers about instead of erroring on the input.
      mockCall.mockResolvedValue(space);
      await H.getSpace({ space: 'https://meet.google.com/lookup/team-standup' }, ACCOUNT);
      expect(mockCall.mock.calls[0][2]).not.toEqual({ name: 'spaces/lookup' });
    });

    it('reports a call in progress when there is one', async () => {
      mockCall.mockResolvedValue({ ...space, activeConference: { conferenceRecord: 'conferenceRecords/xyz' } });
      const result = await H.getSpace({ space: 'abc-mnop-xyz' }, ACCOUNT);

      expect(result.text).toContain('In progress now');
      expect(result.refs.activeConference).toBe('conferenceRecords/xyz');
    });

    it('says plainly when nothing is running', async () => {
      mockCall.mockResolvedValue(space);
      const result = await H.getSpace({ space: 'abc-mnop-xyz' }, ACCOUNT);

      expect(result.text).toContain('**In progress now:** no');
      expect(result.refs.activeConference).toBeNull();
    });
  });

  describe('updateSpace', () => {
    it('builds the updateMask from what was actually passed', async () => {
      // Omit updateMask and Google returns 200 having applied nothing — the silent
      // success this codebase keeps running into.
      // spaces.patch needs the canonical id; a meeting code answers 403 "Permission
      // denied on resource Space", which reads like auth and is not. So: resolve, patch.
      mockCall
        .mockResolvedValueOnce({ ...space, name: 'spaces/CANON' })
        .mockResolvedValueOnce(space);
      await H.updateSpace({ space: 'abc-mnop-xyz', accessType: 'OPEN' }, ACCOUNT);

      expect(mockCall.mock.calls[0][1]).toBe('spaces.get');
      expect(mockCall.mock.calls[1][2]).toEqual({
        name: 'spaces/CANON',
        updateMask: 'config.accessType',
        config: { accessType: 'OPEN' },
      });
    });

    it('masks both fields when both change', async () => {
      mockCall.mockResolvedValue(space);
      await H.updateSpace({ space: 'abc-mnop-xyz', accessType: 'OPEN', moderation: true }, ACCOUNT);

      expect((mockCall.mock.calls[1][2] as Record<string, unknown>).updateMask)
        .toBe('config.accessType,config.moderation');
    });

    it('refuses an update with nothing to change, without paying for a lookup first', async () => {
      await expect(H.updateSpace({ space: 'abc-mnop-xyz' }, ACCOUNT))
        .rejects.toThrow(/at least one of/);
      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe('endActiveConference', () => {
    it('resolves the canonical name first, then ends the call', async () => {
      mockCall
        .mockResolvedValueOnce({ ...space, name: 'spaces/CANON' })  // spaces.get
        .mockResolvedValueOnce({});                                  // endActiveConference
      const result = await H.endActiveConference({ space: 'abc-mnop-xyz' }, ACCOUNT);

      expect(mockCall.mock.calls[0][1]).toBe('spaces.get');
      expect(mockCall.mock.calls[1][1]).toBe('spaces.endActiveConference');
      expect(mockCall.mock.calls[1][2]).toEqual({ name: 'spaces/CANON' });
      expect(result.refs.wasActive).toBe(true);
      expect(result.text).toContain('Everyone who was in it has been disconnected');
    });

    it('answers plainly when no call is running instead of surfacing a 400', async () => {
      // Google refuses with FAILED_PRECONDITION when nothing is in progress. The state
      // the caller asked for already holds, so a raw 400 would invite a retry loop
      // against a condition that will never change.
      const refusal = Object.assign(new Error('There is no active conference for the given space.'),
        { reason: 'FAILED_PRECONDITION' });
      mockCall
        .mockResolvedValueOnce({ ...space, name: 'spaces/CANON' })
        .mockRejectedValueOnce(refusal);

      const result = await H.endActiveConference({ space: 'abc-mnop-xyz' }, ACCOUNT);

      expect(result.refs.wasActive).toBe(false);
      expect(result.refs.ended).toBe(false);
      expect(result.text).toContain('nothing to end');
    });

    it('still throws on any other failure', async () => {
      const denied = Object.assign(new Error('Permission denied'), { reason: 'PERMISSION_DENIED' });
      mockCall
        .mockResolvedValueOnce({ ...space, name: 'spaces/CANON' })
        .mockRejectedValueOnce(denied);

      await expect(H.endActiveConference({ space: 'abc-mnop-xyz' }, ACCOUNT))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('activeConferences', () => {
    it('asks for open-ended records rather than making the agent write EBNF', async () => {
      mockCall.mockResolvedValue({ conferenceRecords: [] });
      await H.activeConferences({}, ACCOUNT);

      expect(mockCall.mock.calls[0][2]).toEqual({ filter: 'end_time IS NULL', pageSize: 25 });
    });

    it('honours the ceiling the manifest advertises', async () => {
      // Custom handlers are dispatched before buildResourceParams, so the manifest's
      // default/max never reach here on their own. Unclamped, maxResults: 5000 went to
      // Google verbatim and -1 became a 400.
      mockCall.mockResolvedValue({ conferenceRecords: [] });
      await H.activeConferences({ maxResults: 5000 }, ACCOUNT);
      expect((mockCall.mock.calls[0][2] as { pageSize: number }).pageSize).toBe(100);

      mockCall.mockReset();
      mockCall.mockResolvedValue({ conferenceRecords: [] });
      await H.activeConferences({ maxResults: -1 }, ACCOUNT);
      expect((mockCall.mock.calls[0][2] as { pageSize: number }).pageSize).toBe(25);
    });

    it('says nothing is running rather than returning an empty list', async () => {
      mockCall.mockResolvedValue({ conferenceRecords: [] });
      const result = await H.activeConferences({}, ACCOUNT);

      expect(result.text).toContain('No conferences are in progress');
      expect(result.refs.count).toBe(0);
    });

    it('lists what is live with its meeting code', async () => {
      mockCall.mockResolvedValue({
        conferenceRecords: [
          { name: 'conferenceRecords/one', space: { name: 'spaces/abc-mnop-xyz' }, startTime: '2026-08-17T15:00:00Z' },
        ],
      });
      const result = await H.activeConferences({}, ACCOUNT);

      expect(result.text).toContain('In progress now (1)');
      expect(result.text).toContain('conferenceRecords/one');
      expect(result.refs.count).toBe(1);
    });
  });
});
