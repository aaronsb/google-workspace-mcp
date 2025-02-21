import { GmailService } from './services/base.js';
import { GmailError } from './types.js';
import { DraftService } from './services/draft.js';

export { GmailService, GmailError, DraftService };

let gmailService: GmailService | null = null;

export async function initializeGmailModule(): Promise<void> {
  gmailService = new GmailService();
  await gmailService.initialize();
}

export function getGmailService(): GmailService {
  if (!gmailService) {
    throw new GmailError(
      'Gmail module not initialized',
      'MODULE_NOT_INITIALIZED',
      'Call initializeGmailModule before using the Gmail service'
    );
  }
  return gmailService;
}
