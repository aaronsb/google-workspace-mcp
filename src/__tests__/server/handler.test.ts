import { handleToolCall } from '../../server/handler.js';
import type { HandlerResponse } from '../../server/handler.js';

// Mock all domain handlers
jest.mock('../../server/handlers/accounts.js');
jest.mock('../../server/handlers/email.js');
jest.mock('../../server/handlers/calendar.js');
jest.mock('../../server/handlers/drive.js');
jest.mock('../../server/queue.js');

import { handleAccounts } from '../../server/handlers/accounts.js';
import { handleEmail } from '../../server/handlers/email.js';
import { handleCalendar } from '../../server/handlers/calendar.js';
import { handleDrive } from '../../server/handlers/drive.js';
import { handleQueue } from '../../server/queue.js';

const mockAccounts = handleAccounts as jest.MockedFunction<typeof handleAccounts>;
const mockEmail = handleEmail as jest.MockedFunction<typeof handleEmail>;
const mockCalendar = handleCalendar as jest.MockedFunction<typeof handleCalendar>;
const mockDrive = handleDrive as jest.MockedFunction<typeof handleDrive>;
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
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('routes manage_email to handleEmail', async () => {
    mockEmail.mockResolvedValue(stubResponse);
    const params = { operation: 'triage', email: 'u@t.com' };

    await handleToolCall('manage_email', params);

    expect(mockEmail).toHaveBeenCalledWith(params);
    expect(mockAccounts).not.toHaveBeenCalled();
  });

  it('routes manage_calendar to handleCalendar', async () => {
    mockCalendar.mockResolvedValue(stubResponse);
    const params = { operation: 'list', email: 'u@t.com' };

    await handleToolCall('manage_calendar', params);

    expect(mockCalendar).toHaveBeenCalledWith(params);
  });

  it('routes manage_drive to handleDrive', async () => {
    mockDrive.mockResolvedValue(stubResponse);
    const params = { operation: 'search', email: 'u@t.com' };

    await handleToolCall('manage_drive', params);

    expect(mockDrive).toHaveBeenCalledWith(params);
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

  it('propagates handler errors', async () => {
    mockEmail.mockRejectedValue(new Error('API failure'));

    await expect(
      handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' }),
    ).rejects.toThrow('API failure');
  });

  it('returns HandlerResponse with text and refs', async () => {
    const expected: HandlerResponse = { text: '## Messages (1)\n\nmsg-1 | alice', refs: { count: 1 } };
    mockEmail.mockResolvedValue(expected);

    const result = await handleToolCall('manage_email', { operation: 'triage', email: 'u@t.com' });

    expect(result.text).toBe(expected.text);
    expect(result.refs).toEqual(expected.refs);
  });
});
