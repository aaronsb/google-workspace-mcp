import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import path from 'path';
import { getAccountManager } from '../accounts/index.js';
import {
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarError,
  CalendarModuleConfig,
  ManageEventParams,
  ManageEventResponse
} from './types.js';
import { AttachmentService } from '../attachments/service.js';
import { DriveService } from '../drive/service.js';
import { ATTACHMENT_FOLDERS, AttachmentSource, AttachmentMetadata } from '../attachments/types.js';

type CalendarEvent = calendar_v3.Schema$Event;
type EventAttachment = calendar_v3.Schema$EventAttachment;

/**
 * Google Calendar Service Implementation
 */
export class CalendarService {
  private oauth2Client!: OAuth2Client;
  private attachmentService?: AttachmentService;
  private driveService?: DriveService;
  private initialized = false;
  private config?: CalendarModuleConfig;

  constructor(config?: CalendarModuleConfig) {
    this.config = config;
  }

  /**
   * Initialize the Calendar service and all dependencies
   */
  public async initialize(): Promise<void> {
    try {
      const accountManager = getAccountManager();
      this.oauth2Client = await accountManager.getAuthClient();
      this.driveService = new DriveService();
      await this.driveService.ensureInitialized();
      this.attachmentService = new AttachmentService({
        maxSizeBytes: this.config?.maxAttachmentSize,
        allowedMimeTypes: this.config?.allowedAttachmentTypes
      });
      this.initialized = true;
    } catch (error) {
      throw new CalendarError(
        'Failed to initialize Calendar service',
        'INIT_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Ensure the Calendar service is initialized
   */
  public async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Check if the service is initialized
   */
  private checkInitialized(): void {
    if (!this.initialized) {
      throw new CalendarError(
        'Calendar service not initialized',
        'INIT_ERROR',
        'Please ensure the service is initialized before use'
      );
    }
  }

  /**
   * Get an authenticated Google Calendar API client
   */
  private async getCalendarClient(email: string) {
    if (!this.initialized) {
      await this.initialize();
    }
    const accountManager = getAccountManager();
    try {
      const tokenStatus = await accountManager.validateToken(email);
      if (!tokenStatus.valid || !tokenStatus.token) {
        throw new CalendarError(
          'Calendar authentication required',
          'AUTH_REQUIRED',
          'Please authenticate to access calendar'
        );
      }

      this.oauth2Client.setCredentials(tokenStatus.token);
      return google.calendar({ version: 'v3', auth: this.oauth2Client });
    } catch (error) {
      if (error instanceof CalendarError) {
        throw error;
      }
      throw new CalendarError(
        'Failed to initialize Calendar client',
        'AUTH_ERROR',
        'Please try again or contact support if the issue persists'
      );
    }
  }

  /**
   * Handle Calendar operations with automatic token refresh on 401/403
   */
  private async handleCalendarOperation<T>(email: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      if (error.code === 401 || error.code === 403) {
        const accountManager = getAccountManager();
        const tokenStatus = await accountManager.validateToken(email);
        if (tokenStatus.valid && tokenStatus.token) {
          this.oauth2Client.setCredentials(tokenStatus.token);
          return await operation();
        }
      }
      throw error;
    }
  }

  /**
   * Process event attachments and store in Drive
   */
  private async processEventAttachments(
    email: string,
    attachments: EventAttachment[]
  ): Promise<AttachmentMetadata[]> {
    if (!this.driveService || !this.attachmentService) {
      throw new CalendarError(
        'Calendar service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized before processing attachments'
      );
    }
    const processedAttachments: AttachmentMetadata[] = [];

    for (const attachment of attachments) {
      if (!attachment.fileId) continue;

      // Get file metadata from Drive
      const fileResult = await this.driveService.downloadFile(email, {
        fileId: attachment.fileId
      });

      if (!fileResult.success) continue;

      const result = await this.attachmentService.processAttachment(
        email,
        {
          content: fileResult.data || '',
          metadata: {
            name: attachment.title || 'untitled',
            mimeType: attachment.mimeType || 'application/octet-stream',
            size: fileResult.data ? Buffer.from(fileResult.data).length : 0
          }
        },
        ATTACHMENT_FOLDERS.EVENT_FILES
      );

      if (result.success && result.attachment) {
        processedAttachments.push(result.attachment);
      }
    }

    return processedAttachments;
  }

  /**
   * Map Calendar event to EventResponse
   */
  private async mapEventResponse(email: string, event: CalendarEvent): Promise<EventResponse> {
    // Process attachments if present
    let attachments: { name: string }[] | undefined;
    
    if (event.attachments && event.attachments.length > 0) {
      // First process and store full metadata
      const processedAttachments = await this.processEventAttachments(email, event.attachments);
      
      // Then return simplified format for AI
      attachments = processedAttachments.map(att => ({
        name: att.name
      }));
    }

    return {
      id: event.id!,
      summary: event.summary || '',
      description: event.description || undefined,
      start: {
        dateTime: event.start?.dateTime || event.start?.date || '',
        timeZone: event.start?.timeZone || 'UTC'
      },
      end: {
        dateTime: event.end?.dateTime || event.end?.date || '',
        timeZone: event.end?.timeZone || 'UTC'
      },
      attendees: event.attendees?.map(attendee => ({
        email: attendee.email!,
        responseStatus: attendee.responseStatus || undefined
      })),
      organizer: event.organizer ? {
        email: event.organizer.email!,
        self: event.organizer.self || false
      } : undefined,
      attachments: attachments?.length ? attachments : undefined
    };
  }

  /**
   * Retrieve calendar events with optional filtering
   */
  async getEvents({ email, query, maxResults = 10, timeMin, timeMax }: GetEventsParams): Promise<EventResponse[]> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: 'primary',
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      };

      if (query) {
        params.q = query;
      }

      if (timeMin) {
        try {
          const date = new Date(timeMin);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          params.timeMin = date.toISOString();
        } catch (error) {
          throw new CalendarError(
            'Invalid date format',
            'INVALID_DATE',
            'Please provide dates in ISO format or YYYY-MM-DD format'
          );
        }
      }

      if (timeMax) {
        try {
          const date = new Date(timeMax);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          params.timeMax = date.toISOString();
        } catch (error) {
          throw new CalendarError(
            'Invalid date format',
            'INVALID_DATE',
            'Please provide dates in ISO format or YYYY-MM-DD format'
          );
        }
      }

      const { data } = await calendar.events.list(params);

      if (!data.items || data.items.length === 0) {
        return [];
      }

      return Promise.all(data.items.map(event => this.mapEventResponse(email, event)));
    });
  }

  /**
   * Retrieve a single calendar event by ID
   */
  async getEvent(email: string, eventId: string): Promise<EventResponse> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
      const { data: event } = await calendar.events.get({
        calendarId: 'primary',
        eventId
      });

      if (!event) {
        throw new CalendarError(
          'Event not found',
          'NOT_FOUND',
          `No event found with ID: ${eventId}`
        );
      }

      return this.mapEventResponse(email, event);
    });
  }

  /**
   * Create a new calendar event
   */
  async createEvent({ email, summary, description, start, end, attendees, attachments = [] }: CreateEventParams): Promise<CreateEventResponse> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
      // Process attachments first
      const processedAttachments: EventAttachment[] = [];
      for (const attachment of attachments) {
        const source: AttachmentSource = {
          content: attachment.content || '',
          metadata: {
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size
          }
        };

        if (!this.attachmentService) {
          throw new CalendarError(
            'Calendar service not initialized',
            'SERVICE_ERROR',
            'Please ensure the service is initialized before processing attachments'
          );
        }
        const result = await this.attachmentService.processAttachment(
          email,
          source,
          ATTACHMENT_FOLDERS.EVENT_FILES
        );

        if (result.success && result.attachment) {
          processedAttachments.push({
            fileId: result.attachment.id,
            title: result.attachment.name,
            mimeType: result.attachment.mimeType
          });
        }
      }

      const eventData: calendar_v3.Schema$Event = {
        summary,
        description,
        start,
        end,
        attendees: attendees?.map(attendee => ({ email: attendee.email })),
        attachments: processedAttachments.length > 0 ? processedAttachments : undefined
      };

      const { data: event } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventData,
        sendUpdates: 'all'
      });

      if (!event.id || !event.summary) {
        throw new CalendarError(
          'Failed to create event',
          'CREATE_ERROR',
          'Event creation response was incomplete'
        );
      }

      // Convert processed attachments to AttachmentMetadata format
      const attachmentMetadata = processedAttachments.length > 0 ? 
        processedAttachments.map(a => ({
          id: a.fileId!,
          name: a.title!,
          mimeType: a.mimeType!,
          size: 0, // Size not available from Calendar API
          path: path.join(this.attachmentService!.getAttachmentPath(ATTACHMENT_FOLDERS.EVENT_FILES), `${a.fileId}_${a.title}`)
        })) : 
        undefined;

      return {
        id: event.id,
        summary: event.summary,
        htmlLink: event.htmlLink || '',
        attachments: attachmentMetadata
      };
    });
  }

  /**
   * Manage calendar event responses and updates
   */
  async manageEvent({ email, eventId, action, comment, newTimes }: ManageEventParams): Promise<ManageEventResponse> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
      const event = await calendar.events.get({
        calendarId: 'primary',
        eventId
      });

      if (!event.data) {
        throw new CalendarError(
          'Event not found',
          'NOT_FOUND',
          `No event found with ID: ${eventId}`
        );
      }

      switch (action) {
        case 'accept':
        case 'decline':
        case 'tentative': {
          const responseStatus = action === 'accept' ? 'accepted' : 
                               action === 'decline' ? 'declined' : 
                               'tentative';

          const { data: updatedEvent } = await calendar.events.patch({
            calendarId: 'primary',
            eventId,
            sendUpdates: 'all',
            requestBody: {
              attendees: [
                {
                  email,
                  responseStatus
                }
              ]
            }
          });

          return {
            success: true,
            eventId,
            action,
            status: 'completed',
            htmlLink: updatedEvent.htmlLink || undefined
          };
        }

        case 'propose_new_time': {
          if (!newTimes || newTimes.length === 0) {
            throw new CalendarError(
              'No proposed times provided',
              'INVALID_REQUEST',
              'Please provide at least one proposed time'
            );
          }

          const counterProposal = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary: `Counter-proposal: ${event.data.summary}`,
              description: `Counter-proposal for original event.\n\nComment: ${comment || 'No comment provided'}\n\nOriginal event: ${event.data.htmlLink}`,
              start: newTimes[0].start,
              end: newTimes[0].end,
              attendees: event.data.attendees
            }
          });

          return {
            success: true,
            eventId,
            action,
            status: 'proposed',
            htmlLink: counterProposal.data.htmlLink || undefined,
            proposedTimes: newTimes.map(time => ({
              start: { dateTime: time.start.dateTime, timeZone: time.start.timeZone || 'UTC' },
              end: { dateTime: time.end.dateTime, timeZone: time.end.timeZone || 'UTC' }
            }))
          };
        }

        case 'update_time': {
          if (!newTimes || newTimes.length === 0) {
            throw new CalendarError(
              'No new time provided',
              'INVALID_REQUEST',
              'Please provide the new time for the event'
            );
          }

          const { data: updatedEvent } = await calendar.events.patch({
            calendarId: 'primary',
            eventId,
            requestBody: {
              start: newTimes[0].start,
              end: newTimes[0].end
            },
            sendUpdates: 'all'
          });

          return {
            success: true,
            eventId,
            action,
            status: 'updated',
            htmlLink: updatedEvent.htmlLink || undefined
          };
        }

        default:
          throw new CalendarError(
            'Supported actions are: accept, decline, tentative, propose_new_time, update_time',
            'INVALID_ACTION',
            'Invalid action'
          );
      }
    });
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(email: string, eventId: string, sendUpdates: 'all' | 'externalOnly' | 'none' = 'all'): Promise<void> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
        sendUpdates
      });
    });
  }
}
