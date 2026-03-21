import * as path from 'node:path';
import * as os from 'node:os';

const APP_NAME = 'google-workspace-mcp';

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

export function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME);
}

export function credentialsDir(): string {
  return path.join(dataDir(), 'credentials');
}

export function emailToSlug(email: string): string {
  // Strip path separators to prevent traversal, then preserve uniqueness
  const safe = email.replace(/[/\\]/g, '');
  return safe.replace(/@/g, '_at_').replace(/\./g, '_dot_');
}

export function credentialPath(email: string): string {
  return path.join(credentialsDir(), `${emailToSlug(email)}.json`);
}

export function accountsFilePath(): string {
  return path.join(configDir(), 'accounts.json');
}
