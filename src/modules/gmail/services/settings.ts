import { google } from 'googleapis';
import {
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError
} from '../types.js';

export class SettingsService {
  constructor(
    private gmailClient?: ReturnType<typeof google.gmail>
  ) {}

  /**
   * Updates the Gmail client instance
   * @param client - New Gmail client instance
   */
  updateClient(client: ReturnType<typeof google.gmail>) {
    this.gmailClient = client;
  }

  private ensureClient(): ReturnType<typeof google.gmail> {
    if (!this.gmailClient) {
      throw new GmailError(
        'Gmail client not initialized',
        'CLIENT_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.gmailClient;
  }

  async getWorkspaceGmailSettings({ email }: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    try {
      // Get profile data
      const client = this.ensureClient();
      const { data: profile } = await client.users.getProfile({
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
        client.users.settings.getAutoForwarding({ userId: 'me' }),
        client.users.settings.getImap({ userId: 'me' }),
        client.users.settings.getLanguage({ userId: 'me' }),
        client.users.settings.getPop({ userId: 'me' }),
        client.users.settings.getVacation({ userId: 'me' })
      ]);

      const response: GetGmailSettingsResponse = {
        profile: {
          emailAddress: profile.emailAddress ?? '',
          messagesTotal: typeof profile.messagesTotal === 'number' ? profile.messagesTotal : 0,
          threadsTotal: typeof profile.threadsTotal === 'number' ? profile.threadsTotal : 0,
          historyId: profile.historyId ?? ''
        },
        settings: {
          ...(language?.displayLanguage && {
            language: {
              displayLanguage: language.displayLanguage
            }
          }),
          ...(autoForwarding && {
            autoForwarding: {
              enabled: Boolean(autoForwarding.enabled),
              ...(autoForwarding.emailAddress && {
                emailAddress: autoForwarding.emailAddress
              })
            }
          }),
          ...(imap && {
            imap: {
              enabled: Boolean(imap.enabled),
              ...(typeof imap.autoExpunge === 'boolean' && {
                autoExpunge: imap.autoExpunge
              }),
              ...(imap.expungeBehavior && {
                expungeBehavior: imap.expungeBehavior
              })
            }
          }),
          ...(pop && {
            pop: {
              enabled: Boolean(pop.accessWindow),
              ...(pop.accessWindow && {
                accessWindow: pop.accessWindow
              })
            }
          }),
          ...(vacation && {
            vacationResponder: {
              enabled: Boolean(vacation.enableAutoReply),
              ...(vacation.startTime && {
                startTime: vacation.startTime
              }),
              ...(vacation.endTime && {
                endTime: vacation.endTime
              }),
              ...(vacation.responseSubject && {
                responseSubject: vacation.responseSubject
              }),
              ...((vacation.responseBodyHtml || vacation.responseBodyPlainText) && {
                message: vacation.responseBodyHtml ?? vacation.responseBodyPlainText ?? ''
              })
            }
          })
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
