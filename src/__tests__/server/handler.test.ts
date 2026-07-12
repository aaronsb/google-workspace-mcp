import { beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';

import { handleToolCall } from '../../server/handler.js';
import type { HandlerResponse } from '../../server/handler.js';

// ONE seam (ADR-103): every factory-generated operation — gmail triage, calendar
// list, drive search — reaches Google through the client we own. Nothing shells
// out, so there is no executor to mock.
vi.mock('../../google/client.js');
// Mock accounts handler — still hand-coded
vi.mock('../../server/handlers/accounts.js');
// Mock queue handler — still hand-coded
vi.mock('../../server/queue.js');

import { call } from '../../google/client.js';
import { handleAccounts } from '../../server/handlers/accounts.js';
import { handleQueue } from '../../server/queue.js';

const mockCall = call as MockedFunction<typeof call>;
const mockAccounts = handleAccounts as MockedFunction<typeof handleAccounts>;
const mockQueue = handleQueue as MockedFunction<typeof handleQueue>;

const stubResponse: HandlerResponse = { text: 'ok', refs: {} };

describe('handleToolCall', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('routes manage_accounts to handleAccounts', async () => {
    mockAccounts.mockResolvedValue(stubResponse);
    const params = { operation: 'list' };

    await handleToolCall('manage_accounts', params);

    expect(mockAccounts).toHaveBeenCalledWith(params);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('routes manage_email to factory-generated handler', async () => {
    // triage is a resource op: users.messages.list with an unread-inbox query.
    mockCall.mockResolvedValue({ messages: [] });
    const params = { operation: 'triage', email: 'u@t.com' };

    const result = await handleToolCall('manage_email', params);

    expect(mockCall).toHaveBeenCalledWith(
      'gmail',
      'users.messages.list',
      expect.objectContaining({ userId: 'me', q: 'is:unread in:inbox' }),
      expect.objectContaining({ account: 'u@t.com' }),
    );
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('refs');
  });

  it('routes manage_calendar to factory-generated handler', async () => {
    // `list` is a resource op — it reaches Google through the client, not gws.
    mockCall.mockResolvedValue({ items: [] });
    const params = { operation: 'list', email: 'u@t.com' };

    const result = await handleToolCall('manage_calendar', params);

    expect(mockCall).toHaveBeenCalledWith(
      'calendar',
      'events.list',
      expect.any(Object),
      expect.objectContaining({ account: 'u@t.com' }),
    );
    expect(result).toHaveProperty('text');
  });

  it('routes manage_drive to factory-generated handler', async () => {
    mockCall.mockResolvedValue({ files: [] });
    const params = { operation: 'search', email: 'u@t.com' };

    const result = await handleToolCall('manage_drive', params);

    expect(mockCall).toHaveBeenCalledWith(
      'drive',
      'files.list',
      expect.any(Object),
      expect.objectContaining({ account: 'u@t.com' }),
    );
    expect(result).toHaveProperty('text');
  });

  it('routes queue_operations to handleQueue with domain handlers', async () => {
    mockQueue.mockResolvedValue(stubResponse);
    const params = { operations: [{ tool: 'manage_email', args: {} }] };

    await handleToolCall('queue_operations', params);

    expect(mockQueue).toHaveBeenCalledWith(params, expect.objectContaining({
      manage_accounts: expect.any(Function),
      manage_email: expect.any(Function),
      manage_calendar: expect.any(Function),
      manage_drive: expect.any(Function),
    }));
  });

  it('throws on unknown tool name', async () => {
    await expect(handleToolCall('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
  });

  it('propagates Google API errors through factory handler', async () => {
    mockCall.mockRejectedValue(new Error('API failure'));

    await expect(
      handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' }),
    ).rejects.toThrow('API failure');
  });

  it('returns HandlerResponse with text and refs from factory handler', async () => {
    // Real Gmail shape: messages.list hands back bare IDs, and the gmail patch's
    // afterExecute hydrates each one via messages.get. gws's invented flat
    // {id, from, subject, date} never existed in the API.
    mockCall.mockResolvedValueOnce({ messages: [{ id: 'msg-1' }] });
    mockCall.mockResolvedValueOnce({
      id: 'msg-1', threadId: 't1', snippet: 'test',
      payload: { headers: [
        { name: 'From', value: 'alice@t.com' },
        { name: 'Subject', value: 'test' },
        { name: 'Date', value: '2024-01-01' },
      ]},
    });

    const result = await handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' });

    expect(result.text).toContain('msg-1');
    expect(result.text).toContain('alice@t.com');
    expect(result.refs).toHaveProperty('count', 1);
  });
});
