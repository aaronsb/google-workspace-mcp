import * as fs from 'node:fs/promises';
import * as credentials from '../../accounts/credentials.js';
import { credentialPath, credentialsDir } from '../../executor/paths.js';

jest.mock('node:fs/promises');
jest.mock('../../executor/gws.js');

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
  });

  describe('removeCredential', () => {
    it('deletes credential file', async () => {
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
