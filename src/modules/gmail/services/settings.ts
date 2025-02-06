import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError
} from '../types.js';

export class SettingsService {
  constructor(
    private gmailClient: ReturnType<typeof google.gmail>,
    private oauth2Client: OAuth2Client
  ) {}

  async getWorkspaceGmailSettings({ email }: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    try {
      // Get profile data
      const { data: profile } = await this.gmailClient.users.getProfile({
        userId: 'me'
      });

      // Get settings data
      const [
        { data: autoForwarding },
        { data: imap },
        { data: language },
        { data: pop },
        { data: vacation }
      ] = await Promise.all([
        this.gmailClient.users.settings.getAutoForwarding({ userId: 'me' }),
        this.gmailClient.users.settings.getImap({ userId: 'me' }),
        this.gmailClient.users.settings.getLanguage({ userId: 'me' }),
        this.gmailClient.users.settings.getPop({ userId: 'me' }),
        this.gmailClient.users.settings.getVacation({ userId: 'me' })
      ]);

      const response: GetGmailSettingsResponse = {
        profile: {
          emailAddress: profile.emailAddress ?? '',
          messagesTotal: typeof profile.messagesTotal === 'number' ? profile.messagesTotal : 0,
          threadsTotal: typeof profile.threadsTotal === 'number' ? profile.threadsTotal : 0,
          historyId: profile.historyId ?? ''
        },
        settings: {
          autoForwarding: {
            enabled: Boolean(autoForwarding.enabled),
            emailAddress: autoForwarding.emailAddress || undefined,
            disposition: autoForwarding.disposition || undefined
          },
          imap: {
            enabled: Boolean(imap.enabled),
            autoExpunge: imap.autoExpunge ?? undefined,
            expungeBehavior: imap.expungeBehavior ?? undefined,
            maxFolderSize: imap.maxFolderSize ?? undefined
          },
          language: {
            displayLanguage: language.displayLanguage || 'en'
          },
          pop: {
            enabled: Boolean(pop.accessWindow !== null),
            accessWindow: pop.accessWindow || undefined,
            disposition: pop.disposition || undefined
          },
          vacationResponder: {
            enabled: Boolean(vacation.enableAutoReply),
            startTime: vacation.startTime || undefined,
            endTime: vacation.endTime || undefined,
            message: (vacation.responseBodyHtml || vacation.responseBodyPlainText) || undefined,
            responseSubject: vacation.responseSubject || undefined
          }
        }
      };

      return response;
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to get Gmail settings',
        'SETTINGS_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
