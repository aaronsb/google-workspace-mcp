import { describe, expect, it, vi, type Mock } from 'vitest';
// Mock handler.js to avoid loading registry.ts (which uses import.meta.url)
vi.mock('../../server/handler.js', () => ({
  advanceEpoch: vi.fn(() => 1),
  getEpoch: vi.fn(() => 1),
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

/**
 * A queue is a tool call, so a queue can hold one. The tool list has no carve-out, and
 * the bound is depth — which arrives as a sentence saying what the limit is, rather than
 * as "Unknown tool" for something the server plainly advertises.
 */
describe('nested queues', () => {
  /** Handlers that can reach a queue, the same shape handler.ts builds. */
  function nestable(depth: number): Record<string, ToolHandler> {
    return {
      ...handlers,
      queue_operations: (p) => handleQueue(p, nestable(depth + 1), depth + 1),
    };
  }

  it('runs a queue inside a queue', async () => {
    const result = await handleQueue({
      operations: [
        { tool: 'tool_a', args: { input: 'outer' } },
        { tool: 'queue_operations', args: { operations: [{ tool: 'tool_a', args: { input: 'inner' } }] } },
      ],
    }, nestable(1), 1);

    expect(result.text).toContain('2/2 succeeded');
    expect(result.refs?.succeeded).toBe(2);
  });

  it('lets an inner failure stay inside when the inner queue continues', async () => {
    // The reason to nest at all: a sub-queue absorbs its own failures instead of bailing
    // the parent.
    const result = await handleQueue({
      operations: [
        {
          tool: 'queue_operations',
          args: {
            operations: [
              { tool: 'tool_fail', args: {}, onError: 'continue' },
              { tool: 'tool_a', args: { input: 'ran anyway' } },
            ],
          },
        },
        { tool: 'tool_a', args: { input: 'parent continued' } },
      ],
    }, nestable(1), 1);

    expect(result.refs?.succeeded).toBe(2);
    expect(result.refs?.failed).toBe(0);
  });

  it('refuses to nest past the bound, and says what the bound is', async () => {
    // Each level multiplies: 10 operations per queue makes depth 3 a 1,000-call ceiling.
    await expect(handleQueue({ operations: [{ tool: 'tool_a', args: {} }] }, nestable(4), 4))
      .rejects.toThrow('nested more than 3 deep');
  });

  it('reports a too-deep nesting as a failed operation rather than losing it', async () => {
    // The throw happens inside the nested call, so the parent records it as an error on
    // that operation. `detail: 'full'` is where the reason is legible.
    const deep = (levels: number): Record<string, unknown> =>
      levels === 0
        ? { tool: 'tool_a', args: { input: 'bottom' } }
        : { tool: 'queue_operations', args: { operations: [deep(levels - 1)] } };

    const result = await handleQueue({ operations: [deep(3)], detail: 'full' }, nestable(1), 1);

    expect(result.text).toContain('nested more than 3 deep');
  });

  it('allows nesting right up to the bound', async () => {
    const result = await handleQueue({
      operations: [{
        tool: 'queue_operations',
        args: { operations: [{ tool: 'queue_operations', args: { operations: [{ tool: 'tool_a', args: {} }] } }] },
      }],
    }, nestable(1), 1);

    expect(result.refs?.succeeded).toBe(1);
    expect(result.text).not.toContain('nested more than');
  });
});

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

describe('a blocked operation is a failure, not a success', () => {
  // Policies decline by RETURNING a response, not by throwing, so the queue's catch never
  // sees them. Before this, a queue of two writes on a read-only account reported
  // "2/2 succeeded" while writing nothing, and `onError: 'bail'` ran the rest anyway.
  const blockingHandler = async () => ({
    text: '**Blocked by safety policy:** not allowed',
    refs: { blocked: true, policy: 'not allowed' },
  });

  it('counts as failed rather than succeeded', async () => {
    const result = await handleQueue(
      { operations: [{ tool: 'manage_contacts', args: { operation: 'create' } }] },
      { manage_contacts: blockingHandler },
    );
    expect(result.text).toContain('0/1 succeeded');
  });

  it('bails the rest of the queue under onError: bail', async () => {
    let secondRan = false;
    const result = await handleQueue(
      {
        operations: [
          { tool: 'manage_contacts', args: { operation: 'create' } },
          { tool: 'manage_email', args: { operation: 'send' } },
        ],
        onError: 'bail',
      },
      {
        manage_contacts: blockingHandler,
        manage_email: async () => { secondRan = true; return { text: 'sent', refs: {} }; },
      },
    );
    expect(secondRan).toBe(false);
    expect(result.text).toContain('0/2 succeeded');
  });
});
