/**
 * Integration tests for handler layer.
 * Verifies that handlers produce correctly shaped output
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
    it('list returns accounts with credential status', async () => {
      const result = await handleAccounts({ operation: 'list' }) as any;

      expect(result.accounts).toBeDefined();
      expect(Array.isArray(result.accounts)).toBe(true);
      expect(result.accounts.length).toBeGreaterThan(0);

      const first = result.accounts[0];
      expect(first).toHaveProperty('email');
      expect(first).toHaveProperty('hasCredential');
      expect(result.next_steps).toBeDefined();
    }, 10_000);
  });

  describe('manage_email', () => {
    it('search returns formatted email list', async () => {
      const result = await handleEmail({
        operation: 'search',
        email: account!.email,
        query: 'in:inbox',
        maxResults: 3,
      }) as any;

      expect(result.emails).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(result.next_steps).toBeDefined();

      if (result.emails.length > 0) {
        expect(result.emails[0]).toHaveProperty('id');
      }
    }, 15_000);

    it('read returns formatted email detail', async () => {
      // First get a message ID
      const list = await handleEmail({
        operation: 'search',
        email: account!.email,
        query: 'in:inbox',
        maxResults: 1,
      }) as any;

      if (list.emails.length === 0) {
        console.warn('No emails in inbox — skipping read test');
        return;
      }

      const messageId = list.emails[0].id;
      const result = await handleEmail({
        operation: 'read',
        email: account!.email,
        messageId,
      }) as any;

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('from');
      expect(result).toHaveProperty('subject');
      expect(result.next_steps).toBeDefined();
    }, 20_000);
  });

  describe('manage_calendar', () => {
    it('list returns formatted events', async () => {
      const result = await handleCalendar({
        operation: 'list',
        email: account!.email,
        maxResults: 5,
      }) as any;

      expect(result.events).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(result.next_steps).toBeDefined();

      if (result.events.length > 0) {
        const event = result.events[0];
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('summary');
        expect(event).toHaveProperty('start');
      }
    }, 15_000);
  });

  describe('manage_drive', () => {
    it('search returns formatted file list', async () => {
      const result = await handleDrive({
        operation: 'search',
        email: account!.email,
        maxResults: 3,
      }) as any;

      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(result.next_steps).toBeDefined();

      if (result.files.length > 0) {
        const file = result.files[0];
        expect(file).toHaveProperty('id');
        expect(file).toHaveProperty('name');
        expect(file).toHaveProperty('mimeType');
      }
    }, 15_000);
  });
});
