import { CalendarService } from '../modules/calendar/service.js';
import { DriveService } from '../modules/drive/service.js';
import { validateEmail } from '../utils/account.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAccountManager } from '../modules/accounts/index.js';

// Singleton instances
let driveService: DriveService;
let calendarService: CalendarService;
let accountManager: ReturnType<typeof getAccountManager>;

const CALENDAR_CONFIG = {
  maxAttachmentSize: 10 * 1024 * 1024, // 10MB
  allowedAttachmentTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'text/plain'
  ]
};

// Initialize services lazily
async function initializeServices() {
  if (!driveService) {
    driveService = new DriveService();
  }
  if (!calendarService) {
    calendarService = new CalendarService(CALENDAR_CONFIG);
    await calendarService.ensureInitialized();
  }
  if (!accountManager) {
    accountManager = getAccountManager();
  }
}

export async function handleListWorkspaceCalendarEvents(params: any) {
  await initializeServices();
  const { email, query, maxResults, timeMin, timeMax } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await calendarService.getEvents({
        email,
        query,
        maxResults,
        timeMin,
        timeMax
      });
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleGetWorkspaceCalendarEvent(params: any) {
  await initializeServices();
  const { email, eventId } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  if (!eventId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event ID is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await calendarService.getEvent(email, eventId);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleCreateWorkspaceCalendarEvent(params: any) {
  await initializeServices();
  const { email, summary, description, start, end, attendees, attachments } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  if (!summary) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event summary is required'
    );
  }

  if (!start || !start.dateTime) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event start time is required'
    );
  }

  if (!end || !end.dateTime) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event end time is required'
    );
  }

  validateEmail(email);
  if (attendees) {
    attendees.forEach((attendee: { email: string }) => validateEmail(attendee.email));
  }

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await calendarService.createEvent({
        email,
        summary,
        description,
        start,
        end,
        attendees,
        attachments: attachments?.map((attachment: {
          driveFileId?: string;
          content?: string;
          name: string;
          mimeType: string;
          size?: number;
        }) => ({
          driveFileId: attachment.driveFileId,
          content: attachment.content,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size
        }))
      });
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleManageWorkspaceCalendarEvent(params: any) {
  await initializeServices();
  const { email, eventId, action, comment, newTimes } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  if (!eventId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event ID is required'
    );
  }

  if (!action) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Action is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await calendarService.manageEvent({
        email,
        eventId,
        action,
        comment,
        newTimes
      });
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleDeleteWorkspaceCalendarEvent(params: any) {
  await initializeServices();
  const { email, eventId, sendUpdates } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  if (!eventId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Event ID is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await calendarService.deleteEvent(email, eventId, sendUpdates);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}
