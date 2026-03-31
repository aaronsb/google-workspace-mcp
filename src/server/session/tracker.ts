/**
 * Session tracker — per-account in-memory state for ambient context.
 *
 * Captures baseline workspace counters on first use per account,
 * refreshes periodically via fire-and-forget, and exposes current
 * deltas for context injection.
 *
 * Refresh is gated by epoch distance — only polls Google APIs when
 * at least REFRESH_EPOCH_INTERVAL tool calls have elapsed since the
 * last refresh, keeping API usage bounded.
 */

import { execute } from '../../executor/gws.js';

/** Minimum epoch distance between refresh polls per account. */
const REFRESH_EPOCH_INTERVAL = 10;

export interface NextEvent {
  summary: string;
  startTime: string;
}

export interface AccountSession {
  baselineUnreadCount: number;
  currentUnreadCount: number;
  baselineTodayEmailCount: number;
  currentTodayEmailCount: number;
  nextEvent: NextEvent | null;
  lastRefreshedEpoch: number;
  initialized: boolean;
}

/** Format today's date as YYYY/MM/DD for Gmail search queries. */
function todayQuery(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO string for end of today (23:59:59 local time). */
function endOfDayISO(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

async function fetchUnreadCount(account: string): Promise<number> {
  const result = await execute([
    'gmail', 'users', 'messages', 'list',
    '--params', JSON.stringify({ userId: 'me', q: 'is:unread', maxResults: 1 }),
  ], { account });
  const data = result.data as Record<string, unknown>;
  return Number(data.resultSizeEstimate ?? 0);
}

async function fetchTodayEmailCount(account: string): Promise<number> {
  const result = await execute([
    'gmail', 'users', 'messages', 'list',
    '--params', JSON.stringify({ userId: 'me', q: `after:${todayQuery()}`, maxResults: 1 }),
  ], { account });
  const data = result.data as Record<string, unknown>;
  return Number(data.resultSizeEstimate ?? 0);
}

async function fetchNextEvent(account: string): Promise<NextEvent | null> {
  const result = await execute([
    'calendar', 'events', 'list',
    '--params', JSON.stringify({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      timeMax: endOfDayISO(),
      maxResults: 1,
      orderBy: 'startTime',
      singleEvents: true,
    }),
  ], { account });
  const data = result.data as Record<string, unknown>;
  const items = (data.items ?? []) as Array<Record<string, unknown>>;
  if (items.length === 0) return null;

  const event = items[0];
  const start = event.start as Record<string, string> | undefined;
  return {
    summary: String(event.summary ?? '(no title)'),
    startTime: start?.dateTime ?? start?.date ?? '',
  };
}

export class SessionTracker {
  private sessions = new Map<string, AccountSession>();

  /** Capture baseline on first call per account. Blocks until complete. */
  async ensureBaseline(email: string, epoch: number): Promise<void> {
    if (this.sessions.has(email)) return;

    try {
      const [unread, today, nextEvt] = await Promise.allSettled([
        fetchUnreadCount(email),
        fetchTodayEmailCount(email),
        fetchNextEvent(email),
      ]);

      const session: AccountSession = {
        baselineUnreadCount: unread.status === 'fulfilled' ? unread.value : 0,
        currentUnreadCount: unread.status === 'fulfilled' ? unread.value : 0,
        baselineTodayEmailCount: today.status === 'fulfilled' ? today.value : 0,
        currentTodayEmailCount: today.status === 'fulfilled' ? today.value : 0,
        nextEvent: nextEvt.status === 'fulfilled' ? nextEvt.value : null,
        lastRefreshedEpoch: epoch,
        initialized: true,
      };

      this.sessions.set(email, session);
    } catch (err) {
      process.stderr.write(
        `[gws-mcp] session baseline failed for ${email}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  /** Fire-and-forget async refresh, gated by epoch staleness. Never throws. */
  refresh(email: string, epoch: number): void {
    const session = this.sessions.get(email);
    if (!session?.initialized) return;
    if (epoch - session.lastRefreshedEpoch < REFRESH_EPOCH_INTERVAL) return;
    void this._doRefresh(email, epoch);
  }

  /** Return current session data, or undefined if not tracked. */
  getContext(email: string): AccountSession | undefined {
    return this.sessions.get(email);
  }

  /** Clear all state (for testing). */
  reset(): void {
    this.sessions.clear();
  }

  private async _doRefresh(email: string, epoch: number): Promise<void> {
    const session = this.sessions.get(email);
    if (!session) return;

    try {
      const [unread, today, nextEvt] = await Promise.allSettled([
        fetchUnreadCount(email),
        fetchTodayEmailCount(email),
        fetchNextEvent(email),
      ]);

      // Guard against stale write: a newer refresh may have landed while we awaited
      if (session.lastRefreshedEpoch > epoch) return;

      if (unread.status === 'fulfilled') session.currentUnreadCount = unread.value;
      if (today.status === 'fulfilled') session.currentTodayEmailCount = today.value;
      if (nextEvt.status === 'fulfilled') session.nextEvent = nextEvt.value;
      session.lastRefreshedEpoch = epoch;
    } catch (err) {
      process.stderr.write(
        `[gws-mcp] session refresh failed for ${email}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
