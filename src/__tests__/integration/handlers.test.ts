/**
 * Integration tests for handler layer.
 * Verifies that handlers produce correctly shaped markdown output
 * when talking to real Google APIs through gws.
 */

import { handleEmail } from '../../server/handlers/email.js';
import { handleCalendar } from '../../server/handlers/calendar.js';
import { handleDrive } from '../../server/handlers/drive.js';
import { handleAccounts } from '../../server/handlers/accounts.js';
import { getTestAccount } from './setup.js';

const account = getTestAccount();
const describeIf = account ? describe : describe.skip;

describeIf('handlers (integration)', () => {
  describe('manage_accounts', () => {
    it('list returns markdown with accounts and next-steps', async () => {
      const result = await handleAccounts({ operation: 'list' });

      expect(result.text).toContain('## Accounts');
      expect(result.text).toContain('[x]'); // at least one account with credentials
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBeGreaterThan(0);
      expect(result.refs.accounts).toBeDefined();
    }, 10_000);
  });

  describe('manage_email', () => {
    it('search returns markdown email list', async () => {
      const result = await handleEmail({
        operation: 'search',
        email: account!.email,
        query: 'in:inbox',
        maxResults: 3,
      });

      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBeGreaterThanOrEqual(0);
    }, 15_000);

    it('read returns markdown email detail', async () => {
      // First get a message ID
      const list = await handleEmail({
        operation: 'search',
        email: account!.email,
        query: 'in:inbox',
        maxResults: 1,
      });

      if (list.refs.count === 0) {
        console.warn('No emails in inbox — skipping read test');
        return;
      }

      const messageId = list.refs.messageId as string;
      const result = await handleEmail({
        operation: 'read',
        email: account!.email,
        messageId,
      });

      expect(result.text).toContain('**From:**');
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.from).toBeDefined();
      expect(result.refs.subject).toBeDefined();
    }, 20_000);
  });

  describe('manage_calendar', () => {
    it('list returns markdown events', async () => {
      const result = await handleCalendar({
        operation: 'list',
        email: account!.email,
        maxResults: 5,
      });

      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBeGreaterThanOrEqual(0);
    }, 15_000);
  });

  describe('manage_drive', () => {
    it('search returns markdown file list', async () => {
      const result = await handleDrive({
        operation: 'search',
        email: account!.email,
        maxResults: 3,
      });

      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBeGreaterThanOrEqual(0);
    }, 15_000);
  });
});
