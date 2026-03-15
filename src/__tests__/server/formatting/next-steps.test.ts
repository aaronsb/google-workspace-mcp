import { nextSteps } from '../../../server/formatting/next-steps.js';

describe('nextSteps', () => {
  it('returns markdown footer for known domain/operation', () => {
    const result = nextSteps('email', 'triage');
    expect(result).toContain('---');
    expect(result).toContain('**Next steps:**');
    expect(result).toContain('manage_email');
  });

  it('returns empty string for unknown domain', () => {
    expect(nextSteps('unknown', 'whatever')).toBe('');
  });

  it('returns empty string for unknown operation', () => {
    expect(nextSteps('email', 'nonexistent')).toBe('');
  });

  it('replaces placeholders with context values', () => {
    const result = nextSteps('email', 'read', { messageId: 'msg-123', email: 'u@t.com' });
    expect(result).toContain('msg-123');
    expect(result).toContain('u@t.com');
  });

  it('leaves unreplaced placeholders as-is', () => {
    const result = nextSteps('email', 'read', { messageId: 'msg-123' });
    // email placeholder not in context, stays as <email>
    expect(result).toContain('<email>');
  });

  it('covers all domains with at least one operation', () => {
    const domainOps: Record<string, string> = {
      accounts: 'list', email: 'triage', calendar: 'list', drive: 'search',
    };
    for (const [domain, op] of Object.entries(domainOps)) {
      const result = nextSteps(domain, op);
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('**Next steps:**');
    }
  });

  it('formats each step with tool name and JSON example', () => {
    const result = nextSteps('drive', 'search');
    // Should contain tool name in backticks and JSON example in backticks
    expect(result).toMatch(/`manage_drive`/);
    expect(result).toMatch(/`\{.*"operation".*\}`/);
  });
});
