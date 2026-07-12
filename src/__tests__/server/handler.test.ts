import { beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';

import { handleToolCall } from '../../server/handler.js';
import type { HandlerResponse } from '../../server/handler.js';

// BOTH seams are mocked (ADR-103): factory-generated RESOURCE ops (calendar
// list, drive search) go through the Google API client we own; HELPER ops
// (gmail +triage) still shell out to gws.
vi.mock('../../executor/gws.js');
vi.mock('../../google/client.js');
// Mock accounts handler — still hand-coded
vi.mock('../../server/handlers/accounts.js');
// Mock queue handler — still hand-coded
vi.mock('../../server/queue.js');

import { execute } from '../../executor/gws.js';
import { call } from '../../google/client.js';
import { handleAccounts } from '../../server/handlers/accounts.js';
import { handleQueue } from '../../server/queue.js';

const mockExecute = execute as MockedFunction<typeof execute>;
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
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('routes manage_email to factory-generated handler', async () => {
    // Factory handler calls execute() for triage (helper: +triage)
    mockExecute.mockResolvedValue({
      success: true,
      data: { messages: [] },
      stderr: '',
    });
    const params = { operation: 'triage', email: 'u@t.com' };

    const result = await handleToolCall('manage_email', params);

    expect(mockExecute).toHaveBeenCalled();
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

  it('propagates executor errors through factory handler', async () => {
    mockExecute.mockRejectedValue(new Error('API failure'));

    await expect(
      handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' }),
    ).rejects.toThrow('API failure');
  });

  it('returns HandlerResponse with text and refs from factory handler', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { messages: [{ id: 'msg-1', from: 'alice', subject: 'test', date: '2024-01-01' }] },
      stderr: '',
    });

    const result = await handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' });

    expect(result.text).toContain('msg-1');
    expect(result.refs).toHaveProperty('count', 1);
  });
});
