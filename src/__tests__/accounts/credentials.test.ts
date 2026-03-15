import * as fs from 'node:fs/promises';
import * as credentials from '../../accounts/credentials.js';
import { credentialPath, credentialsDir } from '../../executor/paths.js';
import { execute } from '../../executor/gws.js';

jest.mock('node:fs/promises');
jest.mock('../../executor/gws.js');

const mockFs = jest.mocked(fs);
const mockExecute = execute as jest.MockedFunction<typeof execute>;

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

  describe('exportAndSaveCredential', () => {
    const validCredential = {
      type: 'authorized_user',
      client_id: 'id-123',
      client_secret: 'secret-456',
      refresh_token: 'token-789',
    };

    beforeEach(() => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it('calls gws auth export --unmasked', async () => {
      mockExecute.mockResolvedValue({ success: true, data: validCredential, stderr: '' });

      await credentials.exportAndSaveCredential('user@example.com');

      expect(mockExecute).toHaveBeenCalledWith(['auth', 'export', '--unmasked']);
    });

    it('creates credentials directory with 0700 permissions', async () => {
      mockExecute.mockResolvedValue({ success: true, data: validCredential, stderr: '' });

      await credentials.exportAndSaveCredential('user@example.com');

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true, mode: 0o700 },
      );
    });

    it('writes credential file with 0600 permissions', async () => {
      mockExecute.mockResolvedValue({ success: true, data: validCredential, stderr: '' });

      await credentials.exportAndSaveCredential('user@example.com');

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        credentialPath('user@example.com'),
        JSON.stringify(validCredential, null, 2),
        { mode: 0o600 },
      );
    });

    it('returns the credential file path', async () => {
      mockExecute.mockResolvedValue({ success: true, data: validCredential, stderr: '' });

      const result = await credentials.exportAndSaveCredential('user@example.com');

      expect(result).toBe(credentialPath('user@example.com'));
    });

    it('rejects when gws returns non-authorized_user type', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: { type: 'service_account', project_id: 'test' },
        stderr: '',
      });

      await expect(
        credentials.exportAndSaveCredential('user@example.com'),
      ).rejects.toThrow('authorized_user');
    });

    it('rejects when gws returns null data', async () => {
      mockExecute.mockResolvedValue({ success: true, data: null, stderr: '' });

      await expect(
        credentials.exportAndSaveCredential('user@example.com'),
      ).rejects.toThrow('authorized_user');
    });

    it('rejects when gws returns empty object', async () => {
      mockExecute.mockResolvedValue({ success: true, data: {}, stderr: '' });

      await expect(
        credentials.exportAndSaveCredential('user@example.com'),
      ).rejects.toThrow('authorized_user');
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
