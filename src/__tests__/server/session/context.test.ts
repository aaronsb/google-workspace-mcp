import { sessionContext } from '../../../server/session/context.js';
import { SessionTracker } from '../../../server/session/tracker.js';
import type { AccountSession } from '../../../server/session/tracker.js';

// Create a tracker with pre-set session data (no API calls needed)
function trackerWith(email: string, session: AccountSession): SessionTracker {
  const tracker = new SessionTracker();
  // Use getContext to verify empty, then set via ensureBaseline internals
  // Instead, we'll use a helper that sets state directly for testing
  (tracker as unknown as { sessions: Map<string, AccountSession> }).sessions.set(email, session);
  return tracker;
}

function baseSession(overrides: Partial<AccountSession> = {}): AccountSession {
  return {
    baselineUnreadCount: 10,
    currentUnreadCount: 10,
    baselineTodayEmailCount: 20,
    currentTodayEmailCount: 20,
    nextEvent: null,
    lastRefreshedEpoch: 1,
    initialized: true,
    ...overrides,
  };
}

describe('sessionContext', () => {
  it('returns empty string when email is undefined', () => {
    const tracker = new SessionTracker();
    expect(sessionContext('manage_email', undefined, tracker)).toBe('');
  });

  it('returns empty string for unknown account', () => {
    const tracker = new SessionTracker();
    expect(sessionContext('manage_email', 'nobody@test.com', tracker)).toBe('');
  });

  it('returns empty string for uninitialized session', () => {
    const tracker = trackerWith('u@t.com', baseSession({ initialized: false }));
    expect(sessionContext('manage_email', 'u@t.com', tracker)).toBe('');
  });

  it('shows positive email delta', () => {
    const tracker = trackerWith('u@t.com', baseSession({
      baselineUnreadCount: 10,
      currentUnreadCount: 13,
      currentTodayEmailCount: 25,
    }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('3 new unread emails since session start');
    expect(result).toContain('13 unread');
    expect(result).toContain('25 today');
  });

  it('shows singular for delta of 1', () => {
    const tracker = trackerWith('u@t.com', baseSession({
      baselineUnreadCount: 10,
      currentUnreadCount: 11,
    }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('1 new unread email since session start');
  });

  it('shows negative delta (user read emails)', () => {
    const tracker = trackerWith('u@t.com', baseSession({
      baselineUnreadCount: 10,
      currentUnreadCount: 8,
    }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('2 fewer unread since session start');
  });

  it('shows zero delta', () => {
    const tracker = trackerWith('u@t.com', baseSession());

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('No new unread emails since session start');
  });

  it('shows next event with relative time', () => {
    const inThirty = new Date(Date.now() + 30 * 60_000).toISOString();
    const tracker = trackerWith('u@t.com', baseSession({
      nextEvent: { summary: 'Standup', startTime: inThirty },
    }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('Next: "Standup" in 30 min');
  });

  it('shows next event with absolute time when >2h away', () => {
    const inFive = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
    const tracker = trackerWith('u@t.com', baseSession({
      nextEvent: { summary: 'Lunch', startTime: inFive },
    }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('Next: "Lunch" at');
    expect(result).toMatch(/at \d{1,2}:\d{2}\s*(AM|PM)/);
  });

  it('shows "no more events" when nextEvent is null', () => {
    const tracker = trackerWith('u@t.com', baseSession({ nextEvent: null }));

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toContain('No more events today');
  });

  it('includes section header with email', () => {
    const tracker = trackerWith('user@example.com', baseSession());

    const result = sessionContext('manage_email', 'user@example.com', tracker);
    expect(result).toContain('**Session context** (user@example.com):');
  });

  it('starts with separator', () => {
    const tracker = trackerWith('u@t.com', baseSession());

    const result = sessionContext('manage_email', 'u@t.com', tracker);
    expect(result).toMatch(/^\n\n---\n/);
  });
});
