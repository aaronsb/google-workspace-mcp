jest.mock('../../../executor/gws.js');

import { execute } from '../../../executor/gws.js';
import { SessionTracker } from '../../../server/session/tracker.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;

function mockGwsResponse(data: unknown) {
  return { success: true, data, stderr: '' };
}

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    jest.resetAllMocks();
    tracker = new SessionTracker();
  });

  describe('ensureBaseline', () => {
    it('captures baseline counts on first call', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))   // unread
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))  // today
        .mockResolvedValueOnce(mockGwsResponse({                                           // calendar
          items: [{ summary: 'Standup', start: { dateTime: '2026-03-31T10:00:00Z' } }],
        }));

      await tracker.ensureBaseline('user@test.com', 1);

      const ctx = tracker.getContext('user@test.com');
      expect(ctx).toBeDefined();
      expect(ctx!.baselineUnreadCount).toBe(5);
      expect(ctx!.currentUnreadCount).toBe(5);
      expect(ctx!.baselineTodayEmailCount).toBe(12);
      expect(ctx!.currentTodayEmailCount).toBe(12);
      expect(ctx!.nextEvent).toEqual({ summary: 'Standup', startTime: '2026-03-31T10:00:00Z' });
      expect(ctx!.initialized).toBe(true);
    });

    it('is idempotent — second call does not re-execute', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('user@test.com', 1);
      const callCount = mockExecute.mock.calls.length;

      await tracker.ensureBaseline('user@test.com', 2);
      expect(mockExecute.mock.calls.length).toBe(callCount);
    });

    it('handles partial API failures gracefully', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))   // unread ok
        .mockRejectedValueOnce(new Error('quota exceeded'))                                 // today fails
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));                             // calendar ok

      await tracker.ensureBaseline('user@test.com', 1);

      const ctx = tracker.getContext('user@test.com');
      expect(ctx).toBeDefined();
      expect(ctx!.baselineUnreadCount).toBe(5);
      expect(ctx!.baselineTodayEmailCount).toBe(0); // fallback
      expect(ctx!.nextEvent).toBeNull();
      expect(ctx!.initialized).toBe(true);
    });

    it('tracks accounts independently', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 3, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 8, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 10, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 20, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('a@test.com', 1);
      await tracker.ensureBaseline('b@test.com', 2);

      expect(tracker.getContext('a@test.com')!.baselineUnreadCount).toBe(3);
      expect(tracker.getContext('b@test.com')!.baselineUnreadCount).toBe(10);
    });
  });

  describe('refresh', () => {
    it('updates current counts but not baseline', async () => {
      // Baseline
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('user@test.com', 1);

      // Refresh
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 8, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 15, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({
          items: [{ summary: 'Lunch', start: { dateTime: '2026-03-31T12:00:00Z' } }],
        }));

      tracker.refresh('user@test.com', 11); // epoch >= baseline + 10 triggers refresh
      // Wait for fire-and-forget to complete
      await new Promise(r => setTimeout(r, 50));

      const ctx = tracker.getContext('user@test.com')!;
      expect(ctx.baselineUnreadCount).toBe(5);  // unchanged
      expect(ctx.currentUnreadCount).toBe(8);
      expect(ctx.baselineTodayEmailCount).toBe(12); // unchanged
      expect(ctx.currentTodayEmailCount).toBe(15);
      expect(ctx.nextEvent).toEqual({ summary: 'Lunch', startTime: '2026-03-31T12:00:00Z' });
    });

    it('retains previous values on refresh failure', async () => {
      // Baseline
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('user@test.com', 1);

      // Refresh — all fail
      mockExecute
        .mockRejectedValueOnce(new Error('network'))
        .mockRejectedValueOnce(new Error('network'))
        .mockRejectedValueOnce(new Error('network'));

      tracker.refresh('user@test.com', 11); // epoch >= baseline + 10 triggers refresh
      await new Promise(r => setTimeout(r, 50));

      const ctx = tracker.getContext('user@test.com')!;
      expect(ctx.currentUnreadCount).toBe(5);  // retained from baseline
      expect(ctx.currentTodayEmailCount).toBe(12);
    });

    it('skips refresh when epoch distance < 10', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('user@test.com', 1);
      const callCount = mockExecute.mock.calls.length;

      tracker.refresh('user@test.com', 5); // only 4 epochs since baseline
      await new Promise(r => setTimeout(r, 50));

      expect(mockExecute.mock.calls.length).toBe(callCount); // no new calls
    });

    it('skips refresh for uninitialized account', () => {
      tracker.refresh('unknown@test.com', 1);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('getContext', () => {
    it('returns undefined for unknown email', () => {
      expect(tracker.getContext('nobody@test.com')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all sessions', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 5, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ resultSizeEstimate: 12, messages: [] }))
        .mockResolvedValueOnce(mockGwsResponse({ items: [] }));

      await tracker.ensureBaseline('user@test.com', 1);
      expect(tracker.getContext('user@test.com')).toBeDefined();

      tracker.reset();
      expect(tracker.getContext('user@test.com')).toBeUndefined();
    });
  });
});
