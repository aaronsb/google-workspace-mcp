import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tracker's three probes (unread, today, next event) are RESOURCE calls, so
// they go through the client we own — not gws (ADR-103). A mocked `call()`
// returns raw Google JSON: no { success, data, stderr } envelope.
vi.mock('../../../google/client.js');
import { mockCall } from '../handlers/__mocks__/client.js';
import { SessionTracker } from '../../../server/session/tracker.js';

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    vi.resetAllMocks();
    tracker = new SessionTracker();
  });

  describe('ensureBaseline', () => {
    it('captures baseline counts on first call', async () => {
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })   // unread
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })  // today
        .mockResolvedValueOnce({                                           // calendar
          items: [{ summary: 'Standup', start: { dateTime: '2026-03-31T10:00:00Z' } }],
        });

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
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('user@test.com', 1);
      const callCount = mockCall.mock.calls.length;

      await tracker.ensureBaseline('user@test.com', 2);
      expect(mockCall.mock.calls.length).toBe(callCount);
    });

    it('handles partial API failures gracefully', async () => {
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })   // unread ok
        .mockRejectedValueOnce(new Error('quota exceeded'))                                 // today fails
        .mockResolvedValueOnce({ items: [] });                             // calendar ok

      await tracker.ensureBaseline('user@test.com', 1);

      const ctx = tracker.getContext('user@test.com');
      expect(ctx).toBeDefined();
      expect(ctx!.baselineUnreadCount).toBe(5);
      expect(ctx!.baselineTodayEmailCount).toBe(0); // fallback
      expect(ctx!.nextEvent).toBeNull();
      expect(ctx!.initialized).toBe(true);
    });

    it('tracks accounts independently', async () => {
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 3, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 8, messages: [] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 10, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 20, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('a@test.com', 1);
      await tracker.ensureBaseline('b@test.com', 2);

      expect(tracker.getContext('a@test.com')!.baselineUnreadCount).toBe(3);
      expect(tracker.getContext('b@test.com')!.baselineUnreadCount).toBe(10);
    });
  });

  describe('refresh', () => {
    it('updates current counts but not baseline', async () => {
      // Baseline
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('user@test.com', 1);

      // Refresh
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 8, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 15, messages: [] })
        .mockResolvedValueOnce({
          items: [{ summary: 'Lunch', start: { dateTime: '2026-03-31T12:00:00Z' } }],
        });

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
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('user@test.com', 1);

      // Refresh — all fail
      mockCall
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
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('user@test.com', 1);
      const callCount = mockCall.mock.calls.length;

      tracker.refresh('user@test.com', 5); // only 4 epochs since baseline
      await new Promise(r => setTimeout(r, 50));

      expect(mockCall.mock.calls.length).toBe(callCount); // no new calls
    });

    it('skips refresh for uninitialized account', () => {
      tracker.refresh('unknown@test.com', 1);
      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe('getContext', () => {
    it('returns undefined for unknown email', () => {
      expect(tracker.getContext('nobody@test.com')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all sessions', async () => {
      mockCall
        .mockResolvedValueOnce({ resultSizeEstimate: 5, messages: [] })
        .mockResolvedValueOnce({ resultSizeEstimate: 12, messages: [] })
        .mockResolvedValueOnce({ items: [] });

      await tracker.ensureBaseline('user@test.com', 1);
      expect(tracker.getContext('user@test.com')).toBeDefined();

      tracker.reset();
      expect(tracker.getContext('user@test.com')).toBeUndefined();
    });
  });
});
