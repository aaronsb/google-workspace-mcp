import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { credentialPath, credentialsDir } from '../executor/paths.js';
import { execute } from '../executor/gws.js';

export interface AuthorizedUserCredential {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export async function hasCredential(email: string): Promise<boolean> {
  try {
    await fs.access(credentialPath(email));
    return true;
  } catch {
    return false;
  }
}

export async function exportAndSaveCredential(email: string): Promise<string> {
  // Ask gws to export the current credential as plaintext
  const result = await execute(['auth', 'export']);
  const credential = result.data as AuthorizedUserCredential;

  if (credential?.type !== 'authorized_user') {
    throw new Error('gws auth export did not return an authorized_user credential');
  }

  const filePath = credentialPath(email);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(credential, null, 2), { mode: 0o600 });

  return filePath;
}

export async function readCredential(email: string): Promise<AuthorizedUserCredential> {
  const filePath = credentialPath(email);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as AuthorizedUserCredential;
}

export async function removeCredential(email: string): Promise<void> {
  try {
    await fs.unlink(credentialPath(email));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function listCredentials(): Promise<string[]> {
  try {
    const dir = credentialsDir();
    const files = await fs.readdir(dir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}
