// Mock handler.js to avoid loading registry.ts (which uses import.meta.url)
jest.mock('../../server/handler.js', () => ({
  advanceEpoch: jest.fn(() => 1),
  getEpoch: jest.fn(() => 1),
}));

import { handleQueue } from '../../server/queue.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

type ToolHandler = (p: Record<string, unknown>) => Promise<HandlerResponse>;

// Mock handlers returning HandlerResponse { text, refs }
const handlers: Record<string, ToolHandler> = {
  tool_a: async (params) => ({
    text: `Result A: ${params.input ?? 'default'}`,
    refs: { id: 'result-a', value: params.input ?? 'default' },
  }),
  tool_b: async (params) => ({
    text: `Result B: ref=${params.ref ?? 'none'}`,
    refs: { id: 'result-b', ref: params.ref ?? 'none' },
  }),
  tool_fail: async () => { throw new Error('intentional failure'); },
};

describe('handleQueue', () => {
  it('executes operations sequentially', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'hello' } },
        { tool: 'tool_b', args: { ref: 'world' } },
      ],
    }, handlers);

    expect(result.text).toContain('2/2 succeeded');
    expect(result.text).toContain('✓ tool_a');
    expect(result.text).toContain('✓ tool_b');
    expect(result.refs.succeeded).toBe(2);
  });

  it('resolves $N.field references from refs', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'first' } },
        { tool: 'tool_b', args: { ref: '$0.id' } },
      ],
    }, handlers);

    // tool_b should have received ref='result-a' (from tool_a's refs.id)
    expect(result.text).toContain('✓ tool_b');
    expect(result.refs.succeeded).toBe(2);
  });

  it('bails on error by default', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_fail', args: {} },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers);

    expect(result.refs.succeeded).toBe(1);
    expect(result.refs.failed).toBe(1);
    expect(result.refs.skipped).toBe(1);
    expect(result.text).toContain('✗ tool_fail');
    expect(result.text).toContain('○ tool_b');
  });

  it('continues on error when onError is continue', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_fail', args: {}, onError: 'continue' },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers);

    expect(result.refs.succeeded).toBe(2);
    expect(result.refs.failed).toBe(1);
    expect(result.refs.skipped).toBe(0);
  });

  it('errors on forward references', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: '$1.id' } },
        { tool: 'tool_b', args: {} },
      ],
    }, handlers);

    expect(result.text).toContain('✗ tool_a');
    expect(result.text).toContain("hasn't run yet");
  });

  it('errors on references to failed operations', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_fail', args: {}, onError: 'continue' },
        { tool: 'tool_b', args: { ref: '$0.id' } },
      ],
    }, handlers);

    expect(result.refs.failed).toBe(2);
  });

  it('errors on missing field in reference', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: {} },
        { tool: 'tool_b', args: { ref: '$0.nonexistent' }, onError: 'continue' },
      ],
    }, handlers);

    expect(result.text).toContain('not found');
  });

  it('errors on unknown tool', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'unknown_tool', args: {} },
      ],
    }, handlers);

    expect(result.text).toContain('✗ unknown_tool');
    expect(result.text).toContain('Unknown tool');
  });

  it('strips next_steps from per-operation text in summary', async () => {
    const handlersWithSteps: Record<string, ToolHandler> = {
      tool_with_steps: async () => ({
        text: 'Some result\n\n---\n**Next steps:**\n- Do something',
        refs: { id: '1' },
      }),
    };

    const result = await handleQueue({
      operations: [{ tool: 'tool_with_steps', args: {} }],
    }, handlersWithSteps);

    // Summary line should not contain next-steps
    const lines = result.text.split('\n');
    const summaryLine = lines.find(l => l.includes('tool_with_steps'));
    expect(summaryLine).not.toContain('Next steps');

    // But consolidated next-steps from last success should be appended
    expect(result.text).toContain('**Next steps:**');
  });

  it('rejects empty operations array', async () => {
    await expect(handleQueue({ operations: [] }, handlers)).rejects.toThrow('must not be empty');
  });

  it('returns markdown summary', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'test' } },
      ],
    }, handlers);

    expect(result.text).toContain('## Queue Results');
    expect(result.text).toContain('1/1 succeeded');
  });

  it('exposes per-operation refs in results array', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'hello' } },
        { tool: 'tool_b', args: { ref: 'world' } },
      ],
    }, handlers);

    const opResults = result.refs.results as Array<Record<string, unknown>>;
    expect(opResults).toHaveLength(2);
    expect(opResults[0]).toMatchObject({ tool: 'tool_a', status: 'success', id: 'result-a' });
    expect(opResults[1]).toMatchObject({ tool: 'tool_b', status: 'success', id: 'result-b' });
  });

  it('includes error status in per-operation results', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_fail', args: {}, onError: 'continue' },
        { tool: 'tool_a', args: {} },
      ],
    }, handlers);

    const opResults = result.refs.results as Array<Record<string, unknown>>;
    expect(opResults[0]).toMatchObject({ tool: 'tool_fail', status: 'error' });
    expect(opResults[1]).toMatchObject({ tool: 'tool_a', status: 'success' });
  });

  describe('detail: full', () => {
    it('includes complete operation output below summary lines', async () => {
      const result = await handleQueue({
        operations: [
          { tool: 'tool_a', args: { input: 'hello' } },
          { tool: 'tool_b', args: { ref: 'world' } },
        ],
        detail: 'full',
      }, handlers);

      expect(result.text).toContain('## Queue Results');
      // Full output should appear
      expect(result.text).toContain('Result A: hello');
      expect(result.text).toContain('Result B: ref=world');
    });

    it('does not include output for failed operations', async () => {
      const result = await handleQueue({
        operations: [
          { tool: 'tool_a', args: {} },
          { tool: 'tool_fail', args: {}, onError: 'continue' },
        ],
        detail: 'full',
      }, handlers);

      expect(result.text).toContain('Result A: default');
      expect(result.text).toContain('✗ tool_fail');
      // Error message appears in summary line, not as full output
    });
  });

  describe('detail: summary (default)', () => {
    it('only shows one-liner per operation, not full output blocks', async () => {
      const result = await handleQueue({
        operations: [
          { tool: 'tool_a', args: { input: 'hello' } },
        ],
      }, handlers);

      // Summary line contains the first content line
      expect(result.text).toContain('✓ tool_a — Result A: hello');
      // No blank-line-separated full output block
      expect(result.text).not.toMatch(/\n\nResult A: hello\n/);
    });
  });
});
