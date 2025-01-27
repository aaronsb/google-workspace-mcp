import { GmailService } from './service.js';
import {
  GetEmailsParams,
  SendEmailParams,
  EmailResponse,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError,
  GmailModuleConfig
} from './types.js';

// Create singleton instance
let gmailService: GmailService | null = null;

export async function initializeGmailModule(config?: GmailModuleConfig): Promise<GmailService> {
  if (!gmailService) {
    gmailService = new GmailService(config);
    await gmailService.initialize();
  }
  return gmailService;
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

export {
  GmailService,
  GetEmailsParams,
  SendEmailParams,
  EmailResponse,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError,
  GmailModuleConfig
};
