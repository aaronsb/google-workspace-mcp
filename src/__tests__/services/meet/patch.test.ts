/**
 * Meet patch tests — formatters and custom handlers.
 */

jest.mock('../../../executor/gws.js');
import { execute } from '../../../executor/gws.js';
const mockExecute = execute as jest.MockedFunction<typeof execute>;

import { meetPatch } from '../../../services/meet/patch.js';
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

    it('formats transcript entries with who-said-what', () => {
      const data = {
        transcriptEntries: [
          {
            participantDisplayName: 'Alice Smith',
            text: 'Hello everyone',
            startTime: '2026-03-18T14:01:00Z',
          },
          {
            participantDisplayName: 'Bob Jones',
            text: 'Hi Alice, lets get started',
            startTime: '2026-03-18T14:01:30Z',
          },
        ],
      };

      const result = meetPatch.formatList!(data, ctx('listTranscriptEntries'));
      expect(result.text).toContain('Transcript (2 entries)');
      expect(result.text).toContain('**Alice Smith**');
      expect(result.text).toContain('Hello everyone');
      expect(result.text).toContain('**Bob Jones**');
      expect(result.refs.count).toBe(2);
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

describe('Meet custom handlers', () => {
  beforeEach(() => mockExecute.mockReset());

  describe('getFullTranscript', () => {
    it('chains transcripts.list, entries.list, and participants.list to resolve names', async () => {
      // Step 1: transcripts.list
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: {
          transcripts: [{
            name: 'conferenceRecords/abc123/transcripts/t1',
            docsDestination: { exportUri: 'https://docs.google.com/doc/abc' },
          }],
        },
      });
      // Step 2 (parallel): entries.list
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: {
          transcriptEntries: [
            { participant: 'conferenceRecords/abc123/participants/111', text: 'Hello', startTime: '2026-03-18T14:01:00Z' },
            { participant: 'conferenceRecords/abc123/participants/222', text: 'Hi there', startTime: '2026-03-18T14:01:30Z' },
          ],
        },
      });
      // Step 2 (parallel): participants.list
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: {
          participants: [
            { name: 'conferenceRecords/abc123/participants/111', signedinUser: { displayName: 'Alice Smith' } },
            { name: 'conferenceRecords/abc123/participants/222', signedinUser: { displayName: 'Bob Jones' } },
          ],
        },
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
      expect(result.text).toContain('Google Docs');
      expect(result.refs.conferenceId).toBe('abc123');
      expect(result.refs.count).toBe(2);

      // Verify the chained calls (3 total: transcripts, then entries + participants in parallel)
      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(mockExecute.mock.calls[0][0]).toEqual(
        expect.arrayContaining(['meet', 'conferenceRecords', 'transcripts', 'list']),
      );
    });

    it('returns helpful message when no transcripts exist', async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: { transcripts: [] },
      });

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
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: {
          transcripts: [{ name: 'conferenceRecords/abc123/transcripts/t1' }],
        },
      });
      // entries.list (parallel)
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: { transcriptEntries: [] },
      });
      // participants.list (parallel)
      mockExecute.mockResolvedValueOnce({
        success: true,
        stderr: '',
        data: { participants: [] },
      });

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
      mockExecute.mockResolvedValueOnce({
        success: true, stderr: '',
        data: { transcripts: [] },
      });

      const handler = meetPatch.customHandlers!.getFullTranscript;
      await handler(
        { conferenceId: 'conferenceRecords/abc123', email: 'user@test.com' },
        'user@test.com',
      );

      const params = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--params') + 1]);
      expect(params.parent).toBe('conferenceRecords/abc123');
    });
  });
});
