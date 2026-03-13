import { handleQueue } from '../../server/queue.js';

// Simple mock handlers
const handlers: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
  tool_a: async (params) => ({ id: 'result-a', value: params.input ?? 'default' }),
  tool_b: async (params) => ({ id: 'result-b', ref: params.ref ?? 'none' }),
  tool_fail: async () => { throw new Error('intentional failure'); },
};

describe('handleQueue', () => {
  it('executes operations sequentially', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'hello' } },
        { tool: 'tool_b', args: { ref: 'world' } },
      ],
    }, handlers) as any;

    expect(result.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(result.results[0].data).toEqual({ id: 'result-a', value: 'hello' });
    expect(result.results[1].data).toEqual({ id: 'result-b', ref: 'world' });
  });

  it('resolves $N.field references', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'first' } },
        { tool: 'tool_b', args: { ref: '$0.id' } },
      ],
    }, handlers) as any;

    expect(result.results[1].data).toEqual({ id: 'result-b', ref: 'result-a' });
  });

  it('bails on error by default', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_fail', args: {} },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers) as any;

    expect(result.summary).toEqual({ total: 3, succeeded: 1, failed: 1, skipped: 1 });
    expect(result.results[1].status).toBe('error');
    expect(result.results[2].status).toBe('skipped');
  });

  it('continues on error when onError is continue', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_fail', args: {}, onError: 'continue' },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers) as any;

    expect(result.summary).toEqual({ total: 3, succeeded: 2, failed: 1, skipped: 0 });
    expect(result.results[2].status).toBe('success');
  });

  it('errors on forward references', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: '$1.id' } },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers) as any;

    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toContain("hasn't run yet");
  });

  it('errors on references to failed operations', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_fail', args: {}, onError: 'continue' },
        { tool: 'tool_b', args: { ref: '$0.id' } },
      ],
    }, handlers) as any;

    expect(result.results[1].status).toBe('error');
    expect(result.results[1].error).toContain('error');
  });

  it('errors on missing field in reference', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_b', args: { ref: '$0.nonexistent' }, onError: 'continue' },
      ],
    }, handlers) as any;

    expect(result.results[1].status).toBe('error');
    expect(result.results[1].error).toContain('not found');
  });

  it('errors on unknown tool', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'unknown_tool', args: {} },
      ],
    }, handlers) as any;

    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toContain('Unknown tool');
  });

  it('strips next_steps from results', async () => {
    const handlersWithSteps: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
      tool_with_steps: async () => ({ id: '1', next_steps: [{ description: 'do something' }] }),
    };

    const result = await handleQueue({
      operations: [{ tool: 'tool_with_steps', args: {} }],
    }, handlersWithSteps) as any;

    expect(result.results[0].data).toEqual({ id: '1' });
    expect(result.results[0].data.next_steps).toBeUndefined();
  });

  it('rejects empty operations array', async () => {
    await expect(handleQueue({ operations: [] }, handlers)).rejects.toThrow('must not be empty');
  });
});
