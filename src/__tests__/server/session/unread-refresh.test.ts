import { describe, expect, it } from 'vitest';
import { inboxUnreadMutationAccounts } from '../../../server/session/unread-refresh.js';

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

  it('finds affected accounts through nested queue and batch calls without duplication', () => {
    expect(inboxUnreadMutationAccounts('bulk_operations', {
      operations: [
        { tool: 'manage_email', args: { operation: 'modify', email: 'queue@example.invalid', addLabelIds: 'UNREAD' } },
        { tool: 'bulk_operations', args: {
          mode: 'batch', tool: 'manage_email', operation: 'trash', email: 'queue@example.invalid', items: ['synthetic-id'],
        } },
      ],
    })).toEqual(['queue@example.invalid']);
  });
});
