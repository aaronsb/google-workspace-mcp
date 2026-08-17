import { describe, expect, it } from 'vitest';
import { scopesForServices, SERVICE_SCOPE_MAP, SERVICE_SCOPE_MAP_READONLY, ALL_SERVICES } from '../../accounts/oauth.js';

describe('oauth', () => {
  describe('SERVICE_SCOPE_MAP', () => {
    it('maps all expected services', () => {
      expect(Object.keys(SERVICE_SCOPE_MAP)).toEqual(
        expect.arrayContaining(['gmail', 'drive', 'calendar', 'sheets', 'docs', 'tasks', 'slides', 'meet']),
      );
    });

    it('meet has three scopes', () => {
      expect(SERVICE_SCOPE_MAP.meet).toHaveLength(3);
      expect(SERVICE_SCOPE_MAP.meet).toContain('https://www.googleapis.com/auth/meetings.space.created');
      expect(SERVICE_SCOPE_MAP.meet).toContain('https://www.googleapis.com/auth/meetings.space.readonly');
      expect(SERVICE_SCOPE_MAP.meet).toContain('https://www.googleapis.com/auth/meetings.space.settings');
    });
  });

  describe('ALL_SERVICES', () => {
    it('contains all service names', () => {
      for (const key of Object.keys(SERVICE_SCOPE_MAP)) {
        expect(ALL_SERVICES).toContain(key);
      }
    });
  });

  describe('scopesForServices', () => {
    it('returns base scopes plus service scopes', () => {
      const { scopes } = scopesForServices('gmail');
      expect(scopes).toContain('openid');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    });

    it('handles comma-separated services', () => {
      const { scopes } = scopesForServices('gmail,drive,calendar');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar');
    });

    it('deduplicates scopes', () => {
      const { scopes } = scopesForServices('gmail,gmail');
      const gmailCount = scopes.filter(s => s.includes('gmail')).length;
      expect(gmailCount).toBe(1);
    });

    it('handles whitespace in service names', () => {
      const { scopes } = scopesForServices(' gmail , drive ');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
    });

    it('is case-insensitive', () => {
      const { scopes } = scopesForServices('Gmail,DRIVE');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
    });

    it('defaults to read/write, so nothing authorized before ADR-202 changes', () => {
      // The invariant that keeps this opt-in. Every existing caller omits `access`.
      const implicit = scopesForServices('gmail,drive,calendar');
      const explicit = scopesForServices('gmail,drive,calendar', 'readwrite');
      expect(implicit.scopes).toEqual(explicit.scopes);
      expect(implicit.scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(implicit.stillAllowWrites).toEqual([]);
    });

    it('requests the read-only scope when access is read', () => {
      const { scopes } = scopesForServices('gmail,drive,calendar,sheets,docs,tasks', 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
      // …and none of the read/write ones.
      expect(scopes).not.toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/drive');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/calendar');
    });

    it('has a read-only option for EVERY service, so nothing over-grants today', () => {
      // The invariant that keeps `access: 'read'` honest. A service added to
      // SERVICE_SCOPE_MAP without a read-only counterpart would silently hand out its
      // read/write scope to anyone asking for read access, which is how permission
      // creeps. Fail here instead.
      const missing = Object.keys(SERVICE_SCOPE_MAP)
        .filter(name => !SERVICE_SCOPE_MAP_READONLY[name]);
      expect(missing).toEqual([]);

      const { stillAllowWrites } = scopesForServices(ALL_SERVICES, 'read');
      expect(stillAllowWrites).toEqual([]);
    });

    it('reads meet through meetings.space.readonly alone', () => {
      // Measured: every operation manage_meet exposes is a GET that this scope
      // authorizes. The read/write entry also carries meetings.space.created and
      // .settings, which exist for CREATING and configuring spaces — this tool does
      // neither. Reading "no read-only variant" off the scope list rather than off what
      // the operations need is what nearly left meet out of the map entirely.
      const { scopes, stillAllowWrites } = scopesForServices('meet', 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/meetings.space.readonly');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/meetings.space.created');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/meetings.space.settings');
      expect(stillAllowWrites).toEqual([]);
    });

    it('reports nothing when every service has a read-only scope', () => {
      const { stillAllowWrites } = scopesForServices('gmail,drive,docs', 'read');
      expect(stillAllowWrites).toEqual([]);
    });

    it('never reports stillAllowWrites for a read/write request', () => {
      // Nothing was asked to restrict, so nothing failed to be restricted.
      const { stillAllowWrites } = scopesForServices(ALL_SERVICES, 'readwrite');
      expect(stillAllowWrites).toEqual([]);
    });

    it('keeps the base scopes under read access', () => {
      const { scopes } = scopesForServices('gmail', 'read');
      expect(scopes).toContain('openid');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('throws on unknown service', () => {
      expect(() => scopesForServices('gmail,bogus')).toThrow('Unknown service');
      expect(() => scopesForServices('gmail,bogus')).toThrow('bogus');
    });

    it('includes all meet scopes when meet is requested', () => {
      const { scopes } = scopesForServices('meet');
      expect(scopes).toContain('https://www.googleapis.com/auth/meetings.space.created');
      expect(scopes).toContain('https://www.googleapis.com/auth/meetings.space.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/meetings.space.settings');
    });

    it('handles all services at once', () => {
      const { scopes } = scopesForServices(ALL_SERVICES);
      // base (2) + gmail(1) + drive(1) + calendar(1) + sheets(1) + docs(1) + tasks(1) + slides(1) + meet(3) = 12
      expect(scopes.length).toBe(12);
    });

    it('ignores empty segments', () => {
      const { scopes } = scopesForServices('gmail,,drive,');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
    });
  });
});
