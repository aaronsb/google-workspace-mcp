import * as fs from 'node:fs/promises';
import { listAccounts, getAccount, addAccount, removeAccount } from '../../accounts/registry.js';

jest.mock('node:fs/promises');
jest.mock('../../accounts/credentials.js');

const mockFs = jest.mocked(fs);

const emptyAccounts = JSON.stringify({ accounts: [] });
const twoAccounts = JSON.stringify({
  accounts: [
    { email: 'a@example.com', category: 'personal' },
    { email: 'b@example.com', category: 'work', description: 'Work account' },
  ],
});

describe('registry', () => {
  beforeEach(() => {
    process.env.XDG_CONFIG_HOME = '/tmp/test-config';
    process.env.XDG_DATA_HOME = '/tmp/test-data';
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
  });

  describe('listAccounts', () => {
    it('returns empty array when no accounts file', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      const { hasCredential } = await import('../../accounts/credentials.js');
      const result = await listAccounts();
      expect(result).toEqual([]);
    });

    it('returns accounts with credential status', async () => {
      mockFs.readFile.mockResolvedValue(twoAccounts);
      const { hasCredential } = await import('../../accounts/credentials.js');
      (hasCredential as jest.Mock).mockResolvedValue(true);

      const result = await listAccounts();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ email: 'a@example.com', hasCredential: true });
    });
  });

  describe('getAccount', () => {
    it('finds account by email', async () => {
      mockFs.readFile.mockResolvedValue(twoAccounts);
      const result = await getAccount('b@example.com');
      expect(result).toMatchObject({ email: 'b@example.com', category: 'work' });
    });

    it('returns undefined for unknown email', async () => {
      mockFs.readFile.mockResolvedValue(twoAccounts);
      const result = await getAccount('unknown@example.com');
      expect(result).toBeUndefined();
    });
  });

  describe('addAccount', () => {
    it('adds new account and writes file', async () => {
      mockFs.readFile.mockResolvedValue(emptyAccounts);
      const result = await addAccount('new@example.com', 'personal', 'My account');
      expect(result.email).toBe('new@example.com');
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('throws when account already exists', async () => {
      mockFs.readFile.mockResolvedValue(twoAccounts);
      await expect(addAccount('a@example.com')).rejects.toThrow('already exists');
    });
  });

  describe('removeAccount', () => {
    it('removes account and credential', async () => {
      mockFs.readFile.mockResolvedValue(twoAccounts);
      const { removeCredential } = await import('../../accounts/credentials.js');

      await removeAccount('a@example.com');
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(removeCredential).toHaveBeenCalledWith('a@example.com');
    });

    it('throws when account not found', async () => {
      mockFs.readFile.mockResolvedValue(emptyAccounts);
      await expect(removeAccount('missing@example.com')).rejects.toThrow('not found');
    });
  });
});
