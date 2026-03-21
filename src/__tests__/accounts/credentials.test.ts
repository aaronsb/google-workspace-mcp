import * as fs from 'node:fs/promises';
import * as credentials from '../../accounts/credentials.js';
import { credentialPath, credentialsDir } from '../../executor/paths.js';

jest.mock('node:fs/promises');

const mockFs = jest.mocked(fs);

describe('credentials', () => {
  beforeEach(() => {
    process.env.XDG_DATA_HOME = '/tmp/test-data';
  });

  describe('hasCredential', () => {
    it('returns true when credential file exists', async () => {
      mockFs.access.mockResolvedValue(undefined);
      expect(await credentials.hasCredential('user@example.com')).toBe(true);
    });

    it('returns false when credential file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      expect(await credentials.hasCredential('user@example.com')).toBe(false);
    });
  });

  describe('readCredential', () => {
    it('reads and parses credential file', async () => {
      const cred = { type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'token' };
      mockFs.readFile.mockResolvedValue(JSON.stringify(cred));

      const result = await credentials.readCredential('user@example.com');
      expect(result).toEqual(cred);
      expect(mockFs.readFile).toHaveBeenCalledWith(
        credentialPath('user@example.com'),
        'utf-8',
      );
    });

    it('throws when credential file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      await expect(credentials.readCredential('user@example.com')).rejects.toThrow('ENOENT');
    });

    it('throws on malformed JSON', async () => {
      mockFs.readFile.mockResolvedValue('not-json{{{');
      await expect(credentials.readCredential('user@example.com')).rejects.toThrow();
    });
  });

  describe('removeCredential', () => {
    it('deletes credential file at the correct path', async () => {
      mockFs.unlink.mockResolvedValue(undefined);
      await credentials.removeCredential('user@example.com');
      expect(mockFs.unlink).toHaveBeenCalledWith(credentialPath('user@example.com'));
    });

    it('ignores ENOENT errors', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockFs.unlink.mockRejectedValue(err);
      await expect(credentials.removeCredential('user@example.com')).resolves.toBeUndefined();
    });

    it('rethrows non-ENOENT errors', async () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      mockFs.unlink.mockRejectedValue(err);
      await expect(credentials.removeCredential('user@example.com')).rejects.toThrow('EACCES');
    });

    it('rethrows errors without code property', async () => {
      mockFs.unlink.mockRejectedValue(new Error('unknown fs error'));
      await expect(credentials.removeCredential('user@example.com')).rejects.toThrow('unknown fs error');
    });
  });

  describe('saveCredential', () => {
    const validCredential: credentials.AuthorizedUserCredential = {
      type: 'authorized_user',
      client_id: 'id-123',
      client_secret: 'secret-456',
      refresh_token: 'token-789',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    };

    beforeEach(() => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it('creates credentials directory with 0700 permissions', async () => {
      await credentials.saveCredential('user@example.com', validCredential);

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true, mode: 0o700 },
      );
    });

    it('writes credential file with 0600 permissions', async () => {
      await credentials.saveCredential('user@example.com', validCredential);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        credentialPath('user@example.com'),
        JSON.stringify(validCredential, null, 2),
        { mode: 0o600 },
      );
    });

    it('returns the credential file path', async () => {
      const result = await credentials.saveCredential('user@example.com', validCredential);
      expect(result).toBe(credentialPath('user@example.com'));
    });

    it('rejects non-authorized_user type', async () => {
      const bad = { type: 'service_account', client_id: 'x', client_secret: 'x', refresh_token: 'x' } as any;
      await expect(credentials.saveCredential('user@example.com', bad)).rejects.toThrow('authorized_user');
    });

    it('rejects null credential', async () => {
      await expect(credentials.saveCredential('user@example.com', null as any)).rejects.toThrow('authorized_user');
    });

    it('preserves scopes in written file', async () => {
      await credentials.saveCredential('user@example.com', validCredential);

      const written = JSON.parse(
        (mockFs.writeFile as jest.Mock).mock.calls[0][1] as string,
      );
      expect(written.scopes).toEqual(['https://www.googleapis.com/auth/gmail.modify']);
    });
  });

  describe('listCredentials', () => {
    it('returns slugs from credential directory', async () => {
      mockFs.readdir.mockResolvedValue(['user_at_example-com.json', 'other_at_test-com.json'] as any);
      const result = await credentials.listCredentials();
      expect(result).toEqual(['user_at_example-com', 'other_at_test-com']);
    });

    it('returns empty array when directory does not exist', async () => {
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
      const result = await credentials.listCredentials();
      expect(result).toEqual([]);
    });

    it('filters non-json files', async () => {
      mockFs.readdir.mockResolvedValue(['cred.json', 'readme.txt', '.DS_Store'] as any);
      const result = await credentials.listCredentials();
      expect(result).toEqual(['cred']);
    });
  });
});
