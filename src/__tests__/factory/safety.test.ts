import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePolicies,
  evaluatePolicies,
  draftOnlyEmail,
  noDelete,
  readOnly,
  auditLog,
} from '../../factory/safety.js';
import type { PatchContext } from '../../factory/types.js';

function ctx(operation: string): PatchContext {
  return { operation, params: {}, account: 'test@test.com' };
}

describe('draftOnlyEmail', () => {
  beforeAll(() => configurePolicies([draftOnlyEmail]));
  afterAll(() => configurePolicies([]));

  it('blocks send', async () => {
    const result = await evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('draft-only');
  });

  it('blocks reply', async () => {
    expect((await evaluatePolicies([], ctx('reply'), 'gmail')).action).toBe('block');
  });

  it('blocks replyAll', async () => {
    expect((await evaluatePolicies([], ctx('replyAll'), 'gmail')).action).toBe('block');
  });

  it('blocks forward', async () => {
    expect((await evaluatePolicies([], ctx('forward'), 'gmail')).action).toBe('block');
  });

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'gmail')).action).toBe('allow');
  });

  it('blocks a filter that forwards, since it sends every future match', async () => {
    for (const operation of ['createFilter', 'updateFilter']) {
      const result = await evaluatePolicies([], { operation, params: { forwardTo: 'ap@example.com' }, account: 'test@test.com' }, 'gmail');
      expect(result.action, operation).toBe('block');
      expect(result.reason).toContain('ap@example.com');
    }
  });

  it('allows a filter that only labels or archives', async () => {
    const result = await evaluatePolicies([], { operation: 'createFilter', params: { removeLabelIds: 'INBOX' }, account: 'test@test.com' }, 'gmail');
    expect(result.action).toBe('allow');
  });

  it('allows triage', async () => {
    expect((await evaluatePolicies([], ctx('triage'), 'gmail')).action).toBe('allow');
  });

  it('allows read', async () => {
    expect((await evaluatePolicies([], ctx('read'), 'gmail')).action).toBe('allow');
  });

  it('does not apply to other services', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('allow');
  });

  describe('drafts are allowed, sends are not (#214)', () => {
    const outbound = ['send', 'reply', 'replyAll', 'forward'];
    const withParams = (operation: string, params: Record<string, unknown>): PatchContext =>
      ({ operation, params, account: 'test@test.com' });

    // Exactly the two values the Gmail handlers treat as "save a draft". A queue `$N`
    // reference stringifies, so 'true' must count as well as true.
    it.each(outbound)('allows %s with draft: true or draft: "true"', async (operation) => {
      for (const draft of [true, 'true']) {
        const result = await evaluatePolicies([], withParams(operation, { draft }), 'gmail');
        expect(result.action, `${operation} draft=${JSON.stringify(draft)}`).toBe('allow');
      }
    });

    // Every other value makes the handler send, so every other value must stay blocked.
    it.each(outbound)('still blocks %s for any value the handler would send', async (operation) => {
      for (const draft of [undefined, false, 'false', 1, '1', 'True', 'TRUE', ' true ', 'yes', [true], { draft: true }]) {
        const result = await evaluatePolicies([], withParams(operation, { draft }), 'gmail');
        expect(result.action, `${operation} draft=${JSON.stringify(draft)}`).toBe('block');
        expect(result.reason).toContain('draft: true');
      }
    });

    it('still blocks a send whose only draft signal is an attachment', async () => {
      // The handler would force a draft here, but the policy only honours the explicit flag.
      const result = await evaluatePolicies([], withParams('send', { attachments: 'report.pdf' }), 'gmail');
      expect(result.action).toBe('block');
    });

    it('still blocks a forwarding filter that also says draft: true', async () => {
      for (const operation of ['createFilter', 'updateFilter']) {
        const result = await evaluatePolicies([], withParams(operation, { forwardTo: 'ap@example.com', draft: true }), 'gmail');
        expect(result.action, operation).toBe('block');
      }
    });
  });
});

describe('draftOnlyEmail composed with readOnly', () => {
  afterAll(() => configurePolicies([]));

  it('a draft is still a write, so read-only blocks it in either order', async () => {
    for (const policies of [[draftOnlyEmail, readOnly], [readOnly, draftOnlyEmail]]) {
      configurePolicies(policies);
      const result = await evaluatePolicies([], { operation: 'reply', params: { draft: true }, account: 'test@test.com' }, 'gmail');
      expect(result.action, policies.map((p) => p.name).join(',')).toBe('block');
    }
  });
});

describe('noDelete', () => {
  beforeAll(() => configurePolicies([noDelete]));
  afterAll(() => configurePolicies([]));

  it('blocks drive delete', async () => {
    const result = await evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('no-delete');
  });

  it('blocks calendar delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'calendar')).action).toBe('block');
  });

  it('blocks task delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'tasks')).action).toBe('block');
  });

  it('blocks deleteTaskList', async () => {
    expect((await evaluatePolicies([], ctx('deleteTaskList'), 'tasks')).action).toBe('block');
  });

  it('blocks gmail deleteDraft (drafts have no trash)', async () => {
    expect((await evaluatePolicies([], ctx('deleteDraft'), 'gmail')).action).toBe('block');
  });

  it('allows gmail trash (reversible)', async () => {
    expect((await evaluatePolicies([], ctx('trash'), 'gmail')).action).toBe('allow');
  });

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'drive')).action).toBe('allow');
  });
});

describe('readOnly', () => {
  beforeAll(() => configurePolicies([readOnly]));
  afterAll(() => configurePolicies([]));

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'gmail')).action).toBe('allow');
  });

  it('allows list', async () => {
    expect((await evaluatePolicies([], ctx('list'), 'calendar')).action).toBe('allow');
  });

  it('allows triage', async () => {
    expect((await evaluatePolicies([], ctx('triage'), 'gmail')).action).toBe('allow');
  });

  it('blocks send', async () => {
    expect((await evaluatePolicies([], ctx('send'), 'gmail')).action).toBe('block');
  });

  it('blocks create', async () => {
    expect((await evaluatePolicies([], ctx('create'), 'calendar')).action).toBe('block');
  });

  it('blocks delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('block');
  });

  it('blocks upload', async () => {
    expect((await evaluatePolicies([], ctx('upload'), 'drive')).action).toBe('block');
  });
});

describe('policy composition', () => {
  beforeAll(() => configurePolicies([auditLog, draftOnlyEmail, noDelete]));
  afterAll(() => configurePolicies([]));

  it('audit allows but draftOnly blocks send', async () => {
    const result = await evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
  });

  it('audit allows and noDelete blocks drive delete', async () => {
    const result = await evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
  });

  it('all allow search', async () => {
    const result = await evaluatePolicies([], ctx('search'), 'gmail');
    expect(result.action).toBe('allow');
  });
});

describe('no policies configured', () => {
  beforeAll(() => configurePolicies([]));

  it('allows everything', async () => {
    expect((await evaluatePolicies([], ctx('send'), 'gmail')).action).toBe('allow');
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('allow');
  });
});
