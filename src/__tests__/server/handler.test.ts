import { handleToolCall } from '../../server/handler.js';
import type { HandlerResponse } from '../../server/handler.js';

// Mock gws executor — all factory-generated handlers call through here
jest.mock('../../executor/gws.js');
// Mock accounts handler — still hand-coded
jest.mock('../../server/handlers/accounts.js');
// Mock queue handler — still hand-coded
jest.mock('../../server/queue.js');

import { execute } from '../../executor/gws.js';
import { handleAccounts } from '../../server/handlers/accounts.js';
import { handleQueue } from '../../server/queue.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;
const mockAccounts = handleAccounts as jest.MockedFunction<typeof handleAccounts>;
const mockQueue = handleQueue as jest.MockedFunction<typeof handleQueue>;

const stubResponse: HandlerResponse = { text: 'ok', refs: {} };

describe('handleToolCall', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('routes manage_accounts to handleAccounts', async () => {
    mockAccounts.mockResolvedValue(stubResponse);
    const params = { operation: 'list' };

    await handleToolCall('manage_accounts', params);

    expect(mockAccounts).toHaveBeenCalledWith(params);
    expect(mockExecute).not.toHaveBeenCalled();
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
    mockExecute.mockResolvedValue({
      success: true,
      data: { items: [] },
      stderr: '',
    });
    const params = { operation: 'list', email: 'u@t.com' };

    const result = await handleToolCall('manage_calendar', params);

    expect(mockExecute).toHaveBeenCalled();
    expect(result).toHaveProperty('text');
  });

  it('routes manage_drive to factory-generated handler', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { files: [] },
      stderr: '',
    });
    const params = { operation: 'search', email: 'u@t.com' };

    const result = await handleToolCall('manage_drive', params);

    expect(mockExecute).toHaveBeenCalled();
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
