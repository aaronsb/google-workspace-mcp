/** Current and compatibility names that dispatch to bulk_operations. */
export const BULK_TOOL_NAMES = ['bulk_operations', 'queue_operations'];

/**
 * How deeply queues may nest.
 *
 * A queue is a tool call, so a queue can hold one — that is what makes the tool list
 * uniform, and it is useful: a nested queue with `onError: 'continue'` fails inside
 * itself without bailing its parent. What it cannot be is unbounded, because each level
 * multiplies: 10 operations per queue means this ceiling is 1,000 calls, which is already
 * more than any real workflow and enough to be worth naming.
 */
export const MAX_QUEUE_DEPTH = 3;
