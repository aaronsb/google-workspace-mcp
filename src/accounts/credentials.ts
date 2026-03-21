import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { credentialPath, credentialsDir } from '../executor/paths.js';

export interface AuthorizedUserCredential {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
  scopes?: string[];
}

export async function hasCredential(email: string): Promise<boolean> {
  try {
    await fs.access(credentialPath(email));
    return true;
  } catch {
    return false;
  }
}

export async function saveCredential(email: string, credential: AuthorizedUserCredential): Promise<string> {
  if (credential?.type !== 'authorized_user') {
    throw new Error('Credential must have type "authorized_user"');
  }

  const filePath = credentialPath(email);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(credential, null, 2), { mode: 0o600 });

  return filePath;
}

export async function readCredential(email: string): Promise<AuthorizedUserCredential> {
  const filePath = credentialPath(email);
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;

  if (parsed.type !== 'authorized_user') {
    throw new Error(`Invalid credential for ${email}: expected type "authorized_user", got "${parsed.type}"`);
  }
  if (!parsed.refresh_token || typeof parsed.refresh_token !== 'string') {
    throw new Error(`Invalid credential for ${email}: missing or invalid refresh_token`);
  }
  if (!parsed.client_id || !parsed.client_secret) {
    throw new Error(`Invalid credential for ${email}: missing client_id or client_secret`);
  }

  return parsed as unknown as AuthorizedUserCredential;
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
