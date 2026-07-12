/**
 * The session-context counts must be COUNTS, not Gmail's estimate of them.
 *
 * `messages.list` returns `resultSizeEstimate`, and it is exactly what it says.
 * Measured against a real mailbox with maxResults=1 it returned the SAME number — 201 —
 * for `is:unread` (truly 135,824) and for `after:<today>` (truly 30). Not a rough
 * figure: a constant, unrelated to the question asked.
 *
 * That made both counts wrong AND made the delta impossible. The baseline and the
 * current reading came from the same constant, so they always agreed, and "No new
 * unread emails since session start" was the only sentence this could ever produce.
 * It never worked, and reported confidently the whole time.
 *
 * Unread now comes from `users.labels.get(INBOX).messagesUnread` — a number Gmail
 * already maintains, exactly, in one call.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
import { SessionTracker } from '../../../server/session/tracker.js';

const mockCall = call as MockedFunction<typeof call>;
const ACCOUNT = 'user@test.com';

/** Route by method, so each count's SOURCE is explicit in the test. */
function route(opts: { inboxUnread: number; todayIds: number }) {
  mockCall.mockImplementation((async (_svc: string, method: string) => {
    if (method === 'users.labels.get') {
      return { id: 'INBOX', messagesTotal: 108262, messagesUnread: opts.inboxUnread };
    }
    if (method === 'users.messages.list') {
      return {
        messages: Array.from({ length: opts.todayIds }, (_, i) => ({ id: `m${i}` })),
        // Present, and deliberately wrong. Nothing may read it.
        resultSizeEstimate: 201,
      };
    }
    if (method === 'events.list') return { items: [] };
    return {};
  }) as unknown as typeof call);
}

describe('session counts', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    vi.resetAllMocks();
    tracker = new SessionTracker();
  });

  it('reads unread from the INBOX label, not from resultSizeEstimate', async () => {
    route({ inboxUnread: 77561, todayIds: 30 });

    await tracker.ensureBaseline(ACCOUNT, 1);
    const s = tracker.getContext(ACCOUNT)!;

    // The bug: this used to be 201 — the estimate — no matter the truth.
    expect(s.currentUnreadCount).toBe(77561);
    expect(s.currentUnreadCount).not.toBe(201);
    expect(s.currentTodayEmailCount).toBe(30);
  });

  it('counts today by the ids returned, not the estimate sitting beside them', async () => {
    route({ inboxUnread: 10, todayIds: 3 });

    await tracker.ensureBaseline(ACCOUNT, 1);
    expect(tracker.getContext(ACCOUNT)!.currentTodayEmailCount).toBe(3);
  });

  it('asks the label API for unread — not messages.list with a query', async () => {
    route({ inboxUnread: 5, todayIds: 1 });
    await tracker.ensureBaseline(ACCOUNT, 1);

    const methods = mockCall.mock.calls.map((c) => c[1]);
    expect(methods).toContain('users.labels.get');
    // No `is:unread` search anywhere — that path is what produced the constant.
    const queries = mockCall.mock.calls.map((c) => (c[2] as Record<string, unknown>)?.q);
    expect(queries).not.toContain('is:unread');
  });

  it('shows a real delta when new mail arrives', async () => {
    // What the line exists to say, and what it structurally could not say before.
    route({ inboxUnread: 100, todayIds: 5 });
    await tracker.ensureBaseline(ACCOUNT, 1);
    expect(tracker.getContext(ACCOUNT)!.baselineUnreadCount).toBe(100);

    route({ inboxUnread: 104, todayIds: 9 });
    tracker.refresh(ACCOUNT, 11);                       // epoch >= baseline + 10 triggers it
    await new Promise((r) => setTimeout(r, 50));        // refresh is fire-and-forget

    const s = tracker.getContext(ACCOUNT)!;
    expect(s.currentUnreadCount).toBe(104);
    expect(s.baselineUnreadCount).toBe(100);                              // baseline holds
    expect(s.currentUnreadCount - s.baselineUnreadCount).toBe(4);        // and the delta moves
  });
});
