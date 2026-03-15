import { nextSteps } from '../../../server/formatting/next-steps.js';

describe('nextSteps', () => {
  it('returns steps for known domain/operation', () => {
    const result = nextSteps('email', 'triage');
    expect(result.next_steps.length).toBeGreaterThan(0);
    expect(result.next_steps[0].tool).toBe('manage_email');
  });

  it('returns empty for unknown domain', () => {
    const result = nextSteps('unknown', 'whatever');
    expect(result.next_steps).toEqual([]);
  });

  it('returns empty for unknown operation', () => {
    const result = nextSteps('email', 'nonexistent');
    expect(result.next_steps).toEqual([]);
  });

  it('replaces placeholders with context values', () => {
    const result = nextSteps('email', 'read', { messageId: 'msg-123' });
    const replyStep = result.next_steps.find(s => s.description.includes('Reply'));
    expect(replyStep?.example).toMatchObject({ messageId: 'msg-123' });
  });

  it('leaves unreplaced placeholders as-is', () => {
    const result = nextSteps('email', 'read', { messageId: 'msg-123' });
    const replyStep = result.next_steps.find(s => s.description.includes('Reply'));
    // email placeholder not in context, stays as <email>
    expect(replyStep?.example).toMatchObject({ email: '<email>' });
  });

  it('covers all domains with at least one operation', () => {
    const domainOps: Record<string, string> = {
      accounts: 'list', email: 'triage', calendar: 'list', drive: 'search',
    };
    for (const [domain, op] of Object.entries(domainOps)) {
      const result = nextSteps(domain, op);
      expect(result.next_steps.length).toBeGreaterThan(0);
    }
  });
});
