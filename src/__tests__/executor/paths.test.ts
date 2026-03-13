import * as os from 'node:os';
import * as path from 'node:path';
import { configDir, dataDir, credentialsDir, credentialPath, accountsFilePath, emailToSlug } from '../../executor/paths.js';

describe('paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('configDir', () => {
    it('uses XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';
      expect(configDir()).toBe('/custom/config/google-workspace-mcp');
    });

    it('falls back to ~/.config', () => {
      delete process.env.XDG_CONFIG_HOME;
      expect(configDir()).toBe(path.join(os.homedir(), '.config', 'google-workspace-mcp'));
    });
  });

  describe('dataDir', () => {
    it('uses XDG_DATA_HOME when set', () => {
      process.env.XDG_DATA_HOME = '/custom/data';
      expect(dataDir()).toBe('/custom/data/google-workspace-mcp');
    });

    it('falls back to ~/.local/share', () => {
      delete process.env.XDG_DATA_HOME;
      expect(dataDir()).toBe(path.join(os.homedir(), '.local', 'share', 'google-workspace-mcp'));
    });
  });

  describe('credentialsDir', () => {
    it('is under dataDir', () => {
      process.env.XDG_DATA_HOME = '/custom/data';
      expect(credentialsDir()).toBe('/custom/data/google-workspace-mcp/credentials');
    });
  });

  describe('emailToSlug', () => {
    it('converts email to filesystem-safe slug', () => {
      expect(emailToSlug('aaronsb@gmail.com')).toBe('aaronsb_at_gmail_dot_com');
      expect(emailToSlug('aaron.bockelie@cprime.com')).toBe('aaron_dot_bockelie_at_cprime_dot_com');
    });

    it('produces unique slugs for similar emails', () => {
      expect(emailToSlug('user.name@example.com')).not.toBe(emailToSlug('user-name@example.com'));
    });
  });

  describe('credentialPath', () => {
    it('returns path under credentials dir', () => {
      process.env.XDG_DATA_HOME = '/data';
      expect(credentialPath('user@example.com')).toBe('/data/google-workspace-mcp/credentials/user_at_example_dot_com.json');
    });
  });

  describe('accountsFilePath', () => {
    it('returns path under config dir', () => {
      process.env.XDG_CONFIG_HOME = '/config';
      expect(accountsFilePath()).toBe('/config/google-workspace-mcp/accounts.json');
    });
  });
});
