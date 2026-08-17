/**
 * manage_scratchpad writes go through the safety layer — issue #171.
 *
 * It is hand-registered rather than factory-generated, so none of its writes passed
 * through `generateHandler` and therefore none reached `evaluatePolicies`. Two distinct
 * failures came out of that, and only one of them had Google as a backstop:
 *
 *   1. A read-only account refused `manage_docs write` could write the same content via
 *      `send`. The token is narrow, so Google refused — what was lost was the explanation.
 *   2. With GWS_SAFETY_POLICY=draft-only-email, an ordinary read/write account could
 *      still send mail through `send`, and GOOGLE ACCEPTED IT, because the token is
 *      legitimately broad. Nothing refused that but the policy that was never consulted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readCredential = vi.hoisted(() => vi.fn());
vi.mock('../../../accounts/credentials.js', () => ({ readCredential }));
vi.mock('../../../google/client.js');
vi.mock('../../../services/gmail/mail.js', () => ({ sendMail: vi.fn() }));

const { handleScratchpad, getScratchpadManager } = await import('../../../server/scratchpad/handler.js');
const { configurePolicies, accountAccess, draftOnlyEmail } = await import('../../../factory/safety.js');
const { SERVICE_SCOPE_MAP, SERVICE_SCOPE_MAP_READONLY } = await import('../../../accounts/oauth.js');
const { call } = await import('../../../google/client.js');
const { sendMail } = await import('../../../services/gmail/mail.js');

const ACCOUNT = 'someone@example.com';

function grant(services: string[], level: 'read' | 'readwrite'): void {
  const map = level === 'read' ? SERVICE_SCOPE_MAP_READONLY : SERVICE_SCOPE_MAP;
  readCredential.mockResolvedValue({ scopes: services.flatMap((s) => map[s] ?? []) });
}

/** A scratchpad holding some content, ready to send. */
function scratchpadWith(content: string): string {
  const id = getScratchpadManager().create({ content });
  return typeof id === 'string' ? id : (id as { id: string }).id;
}

beforeEach(() => {
  vi.mocked(call).mockResolvedValue({} as never);
  vi.mocked(sendMail).mockResolvedValue({ id: 'm1' } as never);
});

afterEach(() => {
  configurePolicies([]);
  readCredential.mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(sendMail).mockReset();
});

describe('a read-only account', () => {
  beforeEach(() => {
    configurePolicies([accountAccess]);
    grant(['docs', 'gmail', 'tasks', 'calendar', 'sheets'], 'read');
  });

  // One case per target that reaches Google. `workspace` is excluded on purpose: it
  // writes a local file and touches no Google API.
  const targets: Array<[string, Record<string, string>, string]> = [
    ['email',          { to: 'a@b.com', subject: 's' },        'gmail'],
    ['email_draft',    { to: 'a@b.com', subject: 's' },        'gmail'],
    ['doc_create',     { title: 't' },                          'docs'],
    ['doc_write',      { documentId: 'd1' },                    'docs'],
    ['sheet_write',    { spreadsheetId: 's1', range: 'A1' },    'sheets'],
    ['calendar_event', { summary: 'e', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' }, 'calendar'],
    ['task_create',    { title: 't' },                          'tasks'],
  ];

  it.each(targets)('is refused on send target %s, naming %s', async (target, extra, service) => {
    const id = scratchpadWith('content');
    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target,
      targetParams: { email: ACCOUNT, ...extra },
    });

    expect(result.text).toContain('Blocked by safety policy');
    expect(result.text).toContain(`services:'${service}'`);
    expect(result.text).toContain(ACCOUNT);
    expect(call).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('leaves the workspace target alone — it writes no Google API', async () => {
    const id = scratchpadWith('content');
    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'workspace',
      targetParams: { email: ACCOUNT, filename: 'note.md' },
    });
    expect(result.text).not.toContain('Blocked by safety policy');
  });
});

describe('a read/write account', () => {
  beforeEach(() => {
    configurePolicies([accountAccess]);
    grant(['docs', 'gmail', 'tasks', 'calendar', 'sheets'], 'readwrite');
  });

  it('sends as before — the policy is a no-op', async () => {
    const id = scratchpadWith('content');
    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'email',
      targetParams: { email: ACCOUNT, to: 'a@b.com', subject: 's' },
    });

    expect(result.text).not.toContain('Blocked by safety policy');
    expect(sendMail).toHaveBeenCalled();
  });
});

describe('the draft-only-email bypass', () => {
  // The half without a Google backstop. The account is fully authorized, so Google
  // accepts the send; the ONLY thing that can refuse it is the policy that was never
  // being consulted. `draft-only-email` exists precisely to stop an agent sending mail.
  beforeEach(() => {
    configurePolicies([draftOnlyEmail]);
    grant(['gmail'], 'readwrite');
  });

  it('no longer lets scratchpad send mail the policy forbids', async () => {
    const id = scratchpadWith('content');
    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'email',
      targetParams: { email: ACCOUNT, to: 'a@b.com', subject: 's' },
    });

    expect(result.text).toContain('Blocked by safety policy');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('still allows a draft, which is what the policy permits', async () => {
    const id = scratchpadWith('content');
    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'email_draft',
      targetParams: { email: ACCOUNT, to: 'a@b.com', subject: 's' },
    });

    expect(result.text).not.toContain('Blocked by safety policy');
  });
});
