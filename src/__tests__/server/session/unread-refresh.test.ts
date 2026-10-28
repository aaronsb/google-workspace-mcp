import { describe, expect, it } from 'vitest';
import { inboxUnreadMutationAccounts, resolvedEmail } from '../../../server/session/unread-refresh.js';
import { MAX_QUEUE_DEPTH } from '../../../server/tool-names.js';

describe('inbox unread mutation accounts', () => {
  it('tracks direct Gmail mutations of INBOX or UNREAD', () => {
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modify', email: 'one@example.invalid', removeLabelIds: 'UNREAD',
    })).toEqual(['one@example.invalid']);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modifyMatching', email: 'two@example.invalid', addLabelIds: ['INBOX'],
    })).toEqual(['two@example.invalid']);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'trash', email: 'three@example.invalid',
    })).toEqual(['three@example.invalid']);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'untrash', email: 'four@example.invalid',
    })).toEqual(['four@example.invalid']);
  });

  it('tracks label changes that move mail into or out of TRASH or SPAM', () => {
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modify', email: 'one@example.invalid', addLabelIds: 'TRASH',
    })).toEqual(['one@example.invalid']);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modify', email: 'two@example.invalid', removeLabelIds: ['SPAM'],
    })).toEqual(['two@example.invalid']);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modifyMatching', email: 'three@example.invalid', addLabelIds: 'SPAM',
    })).toEqual(['three@example.invalid']);
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      mode: 'batch', tool: 'manage_email', operation: 'modify',
      email: 'four@example.invalid', addLabelIds: 'TRASH', items: ['synthetic-id'],
    })).toEqual(['four@example.invalid']);
  });

  it('does not refresh for unrelated labels or filters that affect future mail only', () => {
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'modify', email: 'one@example.invalid', addLabelIds: 'STARRED',
    })).toEqual([]);
    expect(inboxUnreadMutationAccounts('manage_email', {
      operation: 'createFilter', email: 'one@example.invalid', removeLabelIds: 'INBOX',
    })).toEqual([]);
  });

  it('tracks batch modify and trash operations', () => {
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      mode: 'batch', tool: 'manage_email', operation: 'modify',
      email: 'batch@example.invalid', removeLabelIds: 'INBOX', items: ['synthetic-id'],
    })).toEqual(['batch@example.invalid']);
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      mode: 'batch', tool: 'manage_email', operation: 'trash',
      email: 'trash@example.invalid', items: ['synthetic-id'],
    })).toEqual(['trash@example.invalid']);
  });

  it('finds affected accounts through nested queues without duplication', () => {
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      operations: [
        { tool: 'manage_email', args: { operation: 'modify', email: 'queue@example.invalid', addLabelIds: 'UNREAD' } },
        { tool: 'bulk_operations', args: { operations: [
          { tool: 'manage_email', args: { operation: 'trash', email: 'queue@example.invalid' } },
          { tool: 'manage_email', args: { operation: 'trash', email: 'inner@example.invalid' } },
        ] } },
      ],
    })).toEqual(['queue@example.invalid', 'inner@example.invalid']);
  });

  it('skips email values that are unresolved $N references', () => {
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      operations: [
        { tool: 'manage_email', args: { operation: 'trash', email: '$0.email' } },
        { tool: 'manage_email', args: { operation: 'trash', email: 'real@example.invalid' } },
      ],
    })).toEqual(['real@example.invalid']);
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      mode: 'batch', tool: 'manage_email', operation: 'trash', email: '$1.email', items: ['synthetic-id'],
    })).toEqual([]);
  });

  it('stops descending at the queue depth limit without throwing', () => {
    const nest = (levels: number): Record<string, unknown> => ({
      operations: [levels === 0
        ? { tool: 'manage_email', args: { operation: 'trash', email: 'deep@example.invalid' } }
        : { tool: 'bulk_operations', args: nest(levels - 1) }],
    });

    // Queues at depths 1..MAX_QUEUE_DEPTH run; the email op sits one level below the last.
    expect(inboxUnreadMutationAccounts('bulk_operations', nest(MAX_QUEUE_DEPTH - 1)))
      .toEqual(['deep@example.invalid']);
    expect(inboxUnreadMutationAccounts('bulk_operations', nest(MAX_QUEUE_DEPTH))).toEqual([]);
    expect(inboxUnreadMutationAccounts('bulk_operations', nest(5000))).toEqual([]);
  });
});

describe('resolved email', () => {
  it('accepts literal addresses and rejects empty values and $N references', () => {
    expect(resolvedEmail('one@example.invalid')).toBe('one@example.invalid');
    expect(resolvedEmail('')).toBeUndefined();
    expect(resolvedEmail(undefined)).toBeUndefined();
    expect(resolvedEmail('$0.email')).toBeUndefined();
    expect(resolvedEmail('$12.account.email')).toBeUndefined();
  });
});
